import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, WebSocket } from 'ws';
import { InterviewViewportHub } from './interview-viewport.hub';
import { SessionCoordinatorService } from './session-coordinator.service';
import { AutonomousInterviewPhase } from './entities/candidate-autonomous-interview.mysql.entity';

@WebSocketGateway({
  path: '/api/autonomous-interview/viewport',
  cors: { origin: '*' },
})
export class InterviewViewportGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(InterviewViewportGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly hub: InterviewViewportHub,
    private readonly coordinator: SessionCoordinatorService,
  ) {}

  handleConnection(client: WebSocket) {
    client.on('message', (raw) => {
      void this.onMessage(client, raw);
    });
  }

  handleDisconnect(client: WebSocket) {
    this.hub.leaveClient(client);
  }

  onModuleDestroy() {
    this.server?.clients.forEach((c) => c.close());
  }

  private async onMessage(client: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]) {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    try {
      const parsed = JSON.parse(text) as { type?: string; token?: string };
      if (parsed.type === 'join' && parsed.token?.trim()) {
        const token = parsed.token.trim();
        this.hub.join(token, client);
        client.send(JSON.stringify({ type: 'joined', token }));

        try {
          const session = await this.coordinator.getSession(token);
          const hydration = await this.coordinator.getViewportHydration(token);
          if (
            hydration.phase === 'sandbox_code' ||
            hydration.phase === 'closing' ||
            hydration.phase === 'completed'
          ) {
            this.hub.emitViewportShift(token, hydration.phase, hydration.payload);
          }
          if (session.introChatHistory.length) {
            this.hub.emitChatUpdate(token, {
              chatHistory: session.introChatHistory,
              phase:
                session.currentPhase === AutonomousInterviewPhase.BND_INTERVIEW
                  ? 'bnd_interview'
                  : session.currentPhase === AutonomousInterviewPhase.BND_ASSESSMENT
                    ? 'bnd_assessment'
                    : session.currentPhase === AutonomousInterviewPhase.AI_SCREENING
                      ? 'ai_screening'
                      : session.currentPhase === AutonomousInterviewPhase.HR_VERBAL
                        ? 'hr_verbal'
                        : 'ai_verbal',
              currentPhase: session.currentPhase,
            });
          }
        } catch (err) {
          this.logger.debug(
            `Could not hydrate viewport for ${token}: ${err instanceof Error ? err.message : err}`,
          );
        }
        return;
      }
    } catch {
      // ignore malformed frames
    }
    this.logger.debug(`Ignored viewport message: ${text.slice(0, 120)}`);
  }
}
