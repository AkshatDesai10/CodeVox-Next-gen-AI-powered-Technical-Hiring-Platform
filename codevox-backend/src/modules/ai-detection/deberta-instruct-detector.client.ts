import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import axios, { isAxiosError } from 'axios';

import { spawn } from 'child_process';

import { join } from 'path';

import type { AiTextDetectionResult } from './ai-detection.types';



export const DEBERTA_INSTRUCT_MODEL_ID = '1024m/deberta-v3-instruct-text-detector';



type PythonDetectionResult = {

  ai_probability: number;

  human_probability: number;

  verdict: string;

  confidence: number;

  flagged_segments: Array<{ text: string; ai_probability: number; label: string }>;

  model_id?: string;

  error?: string;

};



@Injectable()

export class DebertaInstructDetectorClient {

  private readonly log = new Logger(DebertaInstructDetectorClient.name);



  constructor(private readonly config: ConfigService) {}



  private mode(): 'docker' | 'local' {

    const raw = (this.config.get<string>('AI_DEBERTA_MODE') ?? 'docker').trim().toLowerCase();

    return raw === 'local' ? 'local' : 'docker';

  }



  private serviceUrl(): string {

    return (

      this.config.get<string>('AI_DEBERTA_SERVICE_URL')?.trim().replace(/\/$/, '')

      || 'http://localhost:8010'

    );

  }



  private timeoutMs(): number {

    const raw = Number(this.config.get<string>('AI_DEBERTA_TIMEOUT_MS') ?? 180000);

    return Number.isFinite(raw) && raw > 0 ? raw : 180000;

  }



  private pythonBin(): string {

    return this.config.get<string>('AI_DEBERTA_PYTHON')?.trim() || 'python';

  }



  private scriptPath(): string {

    return join(process.cwd(), 'scripts', 'deberta_instruct_detect.py');

  }



  private hfToken(): string | undefined {

    return (

      this.config.get<string>('HF_ACCESS_TOKEN')?.trim()

      ?? this.config.get<string>('HF_TOKEN')?.trim()

      ?? this.config.get<string>('HUGGINGFACE_API_KEY')?.trim()

    );

  }



  private mapResult(result: PythonDetectionResult, modelId: string): AiTextDetectionResult {

    const aiProbability = result.ai_probability ?? 0.5;

    const humanProbability = result.human_probability ?? 1 - aiProbability;

    const verdict =

      result.verdict

      ?? (aiProbability >= 0.6 ? 'ai_generated' : aiProbability <= 0.4 ? 'human' : 'uncertain');



    return {

      id: `transformer:deberta:${Date.now()}`,

      content_type: `transformer-deberta:${modelId}`,

      verdict,

      confidence: result.confidence ?? Math.max(aiProbability, humanProbability),

      scores: {

        ai_probability: aiProbability,

        human_probability: humanProbability,

      },

      analysis: {

        classifier_score: aiProbability,

      },

      flagged_segments: (result.flagged_segments ?? []).slice(0, 25),

      created_at: new Date().toISOString(),

    };

  }



  private retryDelayMs(): number {
    const raw = Number(this.config.get<string>('AI_DEBERTA_RETRY_DELAY_MS') ?? 15000);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }

  private maxRetries(): number {
    const raw = Number(this.config.get<string>('AI_DEBERTA_MAX_RETRIES') ?? 12);
    return Number.isFinite(raw) && raw > 0 ? raw : 12;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runHttp(text: string, modelId: string): Promise<PythonDetectionResult> {
    const url = `${this.serviceUrl()}/detect`;
    const retries = this.maxRetries();
    const delayMs = this.retryDelayMs();

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post<PythonDetectionResult>(
          url,
          { text },
          {
            timeout: this.timeoutMs(),
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
          },
        );

        if (response.status === 503) {
          const detail = String((response.data as { detail?: unknown })?.detail ?? 'Model is still loading');
          if (attempt < retries) {
            this.log.warn(`DeBERTa model loading (${attempt}/${retries}): ${detail}`);
            await this.sleep(delayMs);
            continue;
          }
          throw new BadGatewayException(
            `DeBERTa model not ready after ${retries} attempts. Check: docker logs deberta-detector-deberta-detector-1`,
          );
        }

        if (response.status >= 400) {
          const detail = response.data?.error
            ?? (typeof response.data === 'object' && response.data !== null && 'detail' in response.data
              ? String((response.data as { detail?: unknown }).detail)
              : `DeBERTa service HTTP ${response.status}`);
          if (response.status === 403 || /restricted|authorized/i.test(String(detail))) {
            throw new BadGatewayException(
              `Access to ${modelId} is restricted. Accept the model license on Hugging Face, then retry.`,
            );
          }
          throw new BadGatewayException(`DeBERTa instruct detector failed: ${detail}`);
        }

        return response.data;
      } catch (err) {
        if (err instanceof BadGatewayException) throw err;
        if (isAxiosError(err)) {
          const retryable = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(err.code ?? '');
          if (retryable && attempt < retries) {
            this.log.warn(
              `DeBERTa service not ready (${err.code}, attempt ${attempt}/${retries}) — retrying in ${delayMs}ms`,
            );
            await this.sleep(delayMs);
            continue;
          }
          const code = err.code ?? 'request_failed';
          throw new BadGatewayException(
            `DeBERTa service unreachable at ${url} (${code}). `
            + 'Start it with: npm run docker:deberta-detector:up — first startup loads the model (~5 min).',
          );
        }
        throw err;
      }
    }

    throw new BadGatewayException('DeBERTa detection failed after retries.');
  }



  private runPython(text: string, modelId: string): Promise<PythonDetectionResult> {

    const token = this.hfToken();

    if (!token) {

      throw new BadGatewayException(

        'HF_ACCESS_TOKEN is required for 1024m/deberta-v3-instruct-text-detector. Request model access on Hugging Face first.',

      );

    }



    return new Promise((resolve, reject) => {

      const child = spawn(this.pythonBin(), [this.scriptPath()], {

        env: {

          ...process.env,

          HF_ACCESS_TOKEN: token,

          AI_TRANSFORMER_MODEL_ID: modelId,

        },

        windowsHide: true,

      });



      let stdout = '';

      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {

        stdout += chunk.toString();

      });

      child.stderr.on('data', (chunk: Buffer) => {

        stderr += chunk.toString();

      });

      child.stdin.write(text);

      child.stdin.end();

      child.on('error', (err) => reject(err));

      child.on('close', (code) => {

        if (code !== 0) {

          const parsed = (() => {

            try {

              return JSON.parse(stderr) as { error?: string };

            } catch {

              return null;

            }

          })();

          const message = parsed?.error ?? (stderr.trim() || `Python detector exited with code ${code}`);

          if (/403|authorized list|restricted/i.test(message)) {

            reject(

              new BadGatewayException(

                `Access to ${modelId} is restricted. Accept the model license on Hugging Face, then retry.`,

              ),

            );

            return;

          }

          reject(new BadGatewayException(`DeBERTa instruct detector failed: ${message}`));

          return;

        }

        try {

          resolve(JSON.parse(stdout) as PythonDetectionResult);

        } catch (err) {

          reject(

            new BadGatewayException(

              `DeBERTa instruct detector returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,

            ),

          );

        }

      });

    });

  }



  private async runDetection(text: string, modelId: string): Promise<PythonDetectionResult> {

    if (this.mode() === 'local') {

      this.log.debug('DeBERTa detection via local Python subprocess');

      return this.runPython(text, modelId);

    }

    this.log.debug(`DeBERTa detection via Docker service ${this.serviceUrl()}`);

    return this.runHttp(text, modelId);

  }



  async detectText(text: string, modelId = DEBERTA_INSTRUCT_MODEL_ID): Promise<AiTextDetectionResult> {

    const clean = text.trim();

    if (clean.length < 20) {

      throw new BadGatewayException('Not enough text for DeBERTa AI detection.');

    }



    const result = await this.runDetection(clean, modelId);

    this.log.debug(`DeBERTa detection complete via ${modelId} (${this.mode()})`);

    return this.mapResult(result, modelId);

  }

}


