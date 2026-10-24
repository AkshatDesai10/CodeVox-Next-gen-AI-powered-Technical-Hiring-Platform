import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type {
  ExecutionContext,
  ExecutionProvider,
  ExecutionResult,
} from '../interfaces/execution-provider.interface';
import { ExecutionOrchestratorService } from '../execution/execution-orchestrator.service';
import { defaultDockerRuntimeConfig, runDockerCommand } from '../execution/docker-runtime.util';

@Injectable()
export class DockerRunnerService implements ExecutionProvider, OnModuleInit {
  private readonly logger = new Logger(DockerRunnerService.name);
  private dockerAvailable: boolean | null = null;
  private readonly config = defaultDockerRuntimeConfig();

  constructor(private readonly orchestrator: ExecutionOrchestratorService) {}

  onModuleInit() {
    // Docker Desktop on Windows often isn't ready the instant Nest boots —
    // retry a few times so we don't stick on a false "not available" warning.
    void this.refreshDockerAvailabilityWithRetry();
  }

  async executeCode(
    language: string,
    sourceCode: string,
    stdin?: string,
    context?: ExecutionContext,
  ): Promise<ExecutionResult> {
    const available = await this.refreshDockerAvailability();
    if (!available) {
      return {
        stdout: '',
        stderr:
          'Docker is not available. Start Docker Desktop (local dev) or mount /var/run/docker.sock (containerized backend).',
        executionTime: 0,
        success: false,
        timedOut: false,
      };
    }

    return this.orchestrator.executeCode(language, sourceCode, stdin, context);
  }

  private async refreshDockerAvailabilityWithRetry(attempts = 5, delayMs = 2000): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      const ok = await this.refreshDockerAvailability({ silentFail: i < attempts - 1 });
      if (ok) return;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private async refreshDockerAvailability(opts?: {
    silentFail?: boolean;
  }): Promise<boolean> {
    if (this.dockerAvailable === true) {
      return true;
    }

    try {
      const result = await runDockerCommand(this.config, ['info']);
      this.dockerAvailable = result.success;
      if (result.success) {
        this.logger.log(
          `Docker is available for assessment code execution (${this.config.dockerCommand}).`,
        );
      } else if (!opts?.silentFail) {
        this.logger.warn(
          'Docker is not available — assessment code execution will fail until Docker is running.',
        );
      }
      return result.success;
    } catch {
      this.dockerAvailable = false;
      if (!opts?.silentFail) {
        this.logger.error('Failed to verify Docker availability.');
      }
      return false;
    }
  }
}
