import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { OpenAiClientService } from '../assessment-platform/assessment-ai/openai-client.service';

export type VivaResumeSnapshot = {
  chat_history?: { role: string; content: string }[];
  current_turn?: number;
  asked_ids?: string[];
  last_question_id?: string | null;
  opening_reply?: string | null;
  bank_index?: number;
};

@Injectable()
export class VoiceEngineClient {
  private readonly logger = new Logger(VoiceEngineClient.name);

  constructor(private readonly openai: OpenAiClientService) {}

  private baseUrl() {
    return (process.env.VOICE_ENGINE_URL ?? 'http://localhost:8001').replace(/\/$/, '');
  }

  private serviceHeaders() {
    const key = process.env.AUTONOMOUS_INTERVIEW_SERVICE_KEY?.trim();
    return key ? { 'x-service-key': key } : {};
  }

  async startAgent(payload: {
    token: string;
    room_name: string;
    phase: 'intro_verbal' | 'ai_verbal' | 'hr_verbal' | 'ai_screening' | 'bnd_assessment' | 'bnd_interview';
    engine?: 'technical' | 'behavioral' | 'screening' | 'bnd_build';
    round_type?: string;
    tech_stack?: string | null;
    resume_skills?: string[];
    candidate_name?: string;
    /** Application / candidate display id used in S3 folder slug (name-id-stage). */
    candidate_id?: string;
    application_id?: string;
    session_type?: 'candidate_interview' | 'student_viva';
    viva_profile?: Record<string, unknown>;
    question_mode?: string;
    language_preference?: string;
    panel_mode?: string;
    question_bank?: Array<{
      id: string;
      topic: string;
      prompt_text: string;
      follow_up_hints?: string[];
      difficulty?: string;
      weight?: number;
    }>;
    sarvam_llm_model?: string;
    max_turns?: number;
    resume?: boolean;
    resume_snapshot?: VivaResumeSnapshot;
    reconnect_grace_sec?: number;
    rubric_criteria?: Array<{
      id: string;
      label: string;
      description?: string | null;
      max_marks: number;
      target_score: number;
      weight_pct: number;
      category?: string;
      question_plan?: Record<string, unknown> | null;
    }>;
    job_profile_context?: Record<string, unknown> | null;
    round_config?: Record<string, unknown> | null;
    /** Mapped from round_config.include_take_home_verification at the Nest boundary. */
    take_home_verification_enabled?: boolean;
    take_home_weight_pct?: number;
    take_home_payload?: Record<string, unknown> | null;
    project_interview_payload?: Record<string, unknown> | null;
    project_build_payload?: Record<string, unknown> | null;
  }): Promise<{ accepted?: boolean; resumed?: boolean }> {
    try {
      const res = await axios.post(`${this.baseUrl()}/api/v1/voice/start-agent`, payload, {
        headers: this.serviceHeaders(),
        timeout: 15_000,
      });
      return res.data as { accepted?: boolean; resumed?: boolean };
    } catch (err) {
      this.logger.warn(
        `Voice agent start failed (non-fatal): ${err.response ? JSON.stringify(err.response.data) : (err instanceof Error ? err.message : err)}`,
      );
      return {};
    }
  }

  async vivaControl(payload: {
    token: string;
    action:
    | 'pause'
    | 'resume'
    | 'inject'
    | 'skip'
    | 'takeover'
    | 'release_ai'
    | 'student_pass'
    | 'set_language';
    text?: string;
    topic?: string;
    language?: string;
  }) {
    try {
      await axios.post(`${this.baseUrl()}/api/v1/voice/viva-control`, payload, {
        headers: this.serviceHeaders(),
        timeout: 15_000,
      });
    } catch (err) {
      this.logger.warn(
        `Viva control failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async isAgentActive(token: string): Promise<boolean> {
    try {
      const res = await axios.get(`${this.baseUrl()}/api/v1/voice/active-agent/${token}`, {
        headers: this.serviceHeaders(),
        timeout: 5_000,
      });
      return Boolean((res.data as { active?: boolean }).active);
    } catch {
      return false;
    }
  }

  async chatTurn(payload: {
    tech_stack: string;
    phase: 'intro_verbal' | 'hr_verbal' | 'ai_screening';
    message: string;
    chat_history: Record<string, unknown>[];
    resume_skills?: string[] | null;
  }): Promise<{
    reply: string;
    chat_history: Record<string, unknown>[];
    agent_turns: number;
    user_turns: number;
    min_turns: number;
    max_turns: number;
    complete: boolean;
    depth_score: number;
  }> {
    try {
      const res = await axios.post(`${this.baseUrl()}/api/v1/voice/chat-turn`, payload, {
        headers: this.serviceHeaders(),
        timeout: 60_000,
      });
      return res.data as {
        reply: string;
        chat_history: Record<string, unknown>[];
        agent_turns: number;
        user_turns: number;
        min_turns: number;
        max_turns: number;
        complete: boolean;
        depth_score: number;
      };
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        this.logger.warn('Voice engine not running on port 8001. Using OPENAI fallback response for local testing.');
        const userTurns = payload.chat_history.filter(c => c.role === 'user').length + (payload.message ? 1 : 0);
        const agentTurns = payload.chat_history.filter(c => c.role === 'assistant').length + 1;
        const history = [...payload.chat_history];
        if (payload.message) history.push({ role: 'user', content: payload.message });
        
        let reply = "Hello! I'm your AI interviewer. To get started, could you briefly introduce yourself and share a bit about your recent projects?";
        
        if (payload.message || history.length > 0) {
          const cvContext = payload.resume_skills?.length ? `The candidate's CV mentions these skills/projects: ${payload.resume_skills.join(', ')}. Use this context if relevant.` : '';
          const wrapUpContext = agentTurns >= 14 ? "CRITICAL: This is the final turn of the interview. Acknowledge their answer and tell them that we are wrapping up the intro section and they can now click Submit or wait for the next phase. Do NOT ask any more questions." : "";
          
          const systemPrompt = `You are a friendly technical AI recruiter conducting an initial screening interview for a ${payload.tech_stack} role.
Your goal is to have a natural, conversational interview. Ask ONE question at a time.
${cvContext}
${wrapUpContext}
Analyze the candidate's latest response. Acknowledge what they said naturally, then ask a relevant, specific follow-up question based on their answer or their CV context.
If their answer was very brief or unclear, ask them to elaborate. Do NOT repeat the same question twice.
Keep your response conversational, concise (2-3 sentences max), and spoken like a human.

Respond ONLY with a JSON object in this exact schema:
{
  "reply": "Your conversational response and next question"
}`;

          try {
            const llmMessages = [
              { role: 'system' as const, content: systemPrompt },
              ...history.map(m => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant'|'user', content: String(m.content) }))
            ];
            const detailed = await this.openai.chatJsonDetailed<{ reply: string }>(llmMessages);
            const response = detailed.data;
            if ((response as Record<string, unknown> | undefined)?.__isFallback) {
              this.logger.warn('OpenAI fallback response rejected for live voice interview turn; skipping injection into chat history.');
              return {
                reply: `I’m retrying that response. Could you give me one more detail about the project or technology you just mentioned?`,
                chat_history: history,
                agent_turns: agentTurns,
                user_turns: userTurns,
                min_turns: 3,
                max_turns: 15,
                complete: false,
                depth_score: 0,
              };
            }
            if (response && response.reply) {
              reply = response.reply;
            }
          } catch (aiErr) {
            this.logger.error('Failed to generate mock reply with OpenAI', aiErr);
            reply = `That's very interesting. Based on what you said, can you dive deeper into the technical challenges you faced?`;
          }
        }
        
        history.push({ role: 'assistant', content: reply });
        
        return {
          reply,
          chat_history: history,
          agent_turns: agentTurns,
          user_turns: userTurns,
          min_turns: 3,
          max_turns: 15,
          complete: agentTurns >= 15,
          depth_score: 85,
        };
      }
      throw err;
    }
  }

  async analyzeSubmission(payload: {
    token: string;
    source_code: string;
    language?: string;
  }): Promise<{ code_quality_score: number; architectural_flaws: string[] }> {
    try {
      const res = await axios.post(
        `${this.baseUrl()}/api/v1/analyze-submission`,
        payload,
        { headers: this.serviceHeaders(), timeout: 60_000 },
      );
      return res.data as { code_quality_score: number; architectural_flaws: string[] };
    } catch (err) {
      this.logger.warn(
        `Analyze submission fallback: ${err instanceof Error ? err.message : err}`,
      );
      return { code_quality_score: 0, architectural_flaws: ['analysis_unavailable'] };
    }
  }
}
