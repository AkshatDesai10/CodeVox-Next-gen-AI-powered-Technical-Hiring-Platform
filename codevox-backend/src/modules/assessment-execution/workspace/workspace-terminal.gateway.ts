import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { Server, WebSocket } from 'ws';
import { resolveDockerCommand } from '../execution/docker-runtime.util';
import { WorkspaceService } from './workspace.service';

type TerminalSession = {
  proc: ChildProcessWithoutNullStreams;
  attemptId: string;
};

@WebSocketGateway({
  path: '/api/assessment/workspace/terminal',
  cors: { origin: '*' },
})
export class WorkspaceTerminalGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(WorkspaceTerminalGateway.name);
  private readonly dockerCommand = resolveDockerCommand();
  private readonly useShell = process.env.ASSESSMENT_DOCKER_USE_SHELL === 'true';
  private readonly sessions = new Map<WebSocket, TerminalSession>();

  @WebSocketServer()
  server!: Server;

  constructor(private readonly workspace: WorkspaceService) {}

  handleConnection(client: WebSocket) {
    client.on('message', (raw) => this.onClientMessage(client, raw));
  }

  handleDisconnect(client: WebSocket) {
    this.stopTerminal(client);
  }

  onModuleDestroy() {
    for (const client of this.sessions.keys()) {
      this.stopTerminal(client);
    }
  }

  private onClientMessage(client: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]) {
    const session = this.sessions.get(client);
    if (session) {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (text.startsWith('{"type":"input"')) {
        try {
          const parsed = JSON.parse(text) as { data?: string };
          if (parsed.data) session.proc.stdin.write(parsed.data);
        } catch {
          session.proc.stdin.write(text);
        }
      } else {
        session.proc.stdin.write(text);
      }
      return;
    }

    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    try {
      const msg = JSON.parse(text) as {
        type?: string;
        candidateAssessmentId?: string;
      };
      if (msg.type === 'attach' && msg.candidateAssessmentId) {
        this.attachTerminal(client, msg.candidateAssessmentId);
      }
    } catch {
      client.send(JSON.stringify({ type: 'error', message: 'Invalid attach message' }));
    }
  }

  private attachTerminal(client: WebSocket, attemptId: string) {
    this.stopTerminal(client);

    let session;
    try {
      session = this.workspace.requireSession(attemptId);
    } catch {
      client.send(JSON.stringify({ type: 'error', message: 'Workspace not provisioned' }));
      return;
    }

    const proc = spawn(
      this.dockerCommand,
      ['exec', '-i', session.containerName, '/bin/bash', '--noprofile', '--norc'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: this.useShell,
        env: { ...process.env, TERM: 'xterm-256color', PS1: 'workspace$ ' },
      },
    );

    this.sessions.set(client, { proc, attemptId });

    proc.stdout.on('data', (chunk: Buffer) => {
      if (client.readyState === client.OPEN) client.send(chunk);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      if (client.readyState === client.OPEN) client.send(chunk);
    });
    proc.on('close', () => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: 'exit' }));
      }
      this.sessions.delete(client);
    });
    proc.on('error', (err) => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      this.sessions.delete(client);
    });

    client.send(
      JSON.stringify({
        type: 'ready',
        candidateAssessmentId: attemptId,
        cwd: '/workspace',
      }),
    );
  }

  private stopTerminal(client: WebSocket) {
    const session = this.sessions.get(client);
    if (!session) return;
    session.proc.kill('SIGTERM');
    this.sessions.delete(client);
  }
}
