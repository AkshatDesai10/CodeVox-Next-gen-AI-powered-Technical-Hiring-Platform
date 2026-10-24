import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

export type ViewportShiftMessage = {
  type: 'VIEWPORT_SHIFT';
  phase: string;
  payload?: Record<string, unknown>;
};

export type ChatUpdateMessage = {
  type: 'CHAT_UPDATE';
  payload: {
    chatHistory: { role: string; content: string }[];
    phase?: string;
    currentPhase?: string;
    subPhase?: string;
  };
};

export type ProctorAlertMessage = {
  type: 'PROCTOR_ALERT';
  payload: { eventType: string; severity: string; message?: string };
};

export type ViewportHubMessage =
  | ViewportShiftMessage
  | ChatUpdateMessage
  | ProctorAlertMessage;

@Injectable()
export class InterviewViewportHub {
  private readonly rooms = new Map<string, Set<WebSocket>>();

  join(candidateToken: string, client: WebSocket) {
    const key = this.roomKey(candidateToken);
    let set = this.rooms.get(key);
    if (!set) {
      set = new Set();
      this.rooms.set(key, set);
    }
    set.add(client);
  }

  leave(candidateToken: string, client: WebSocket) {
    const key = this.roomKey(candidateToken);
    const set = this.rooms.get(key);
    if (!set) return;
    set.delete(client);
    if (!set.size) this.rooms.delete(key);
  }

  leaveClient(client: WebSocket) {
    for (const [key, set] of this.rooms.entries()) {
      if (set.delete(client) && !set.size) {
        this.rooms.delete(key);
      }
    }
  }

  emitViewportShift(
    candidateToken: string,
    phase: string,
    payload?: Record<string, unknown>,
  ) {
    const message: ViewportShiftMessage = { type: 'VIEWPORT_SHIFT', phase, payload };
    this.broadcast(candidateToken, message);
  }

  emitChatUpdate(
    candidateToken: string,
    payload: ChatUpdateMessage['payload'],
  ) {
    const message: ChatUpdateMessage = { type: 'CHAT_UPDATE', payload };
    this.broadcast(candidateToken, message);
  }

  emitProctorAlert(
    candidateToken: string,
    payload: ProctorAlertMessage['payload'],
  ) {
    const message: ProctorAlertMessage = { type: 'PROCTOR_ALERT', payload };
    this.broadcast(candidateToken, message);
  }

  private broadcast(candidateToken: string, message: ViewportHubMessage) {
    const raw = JSON.stringify(message);
    const set = this.rooms.get(this.roomKey(candidateToken));
    if (!set) return;
    for (const client of set) {
      if (client.readyState === 1) {
        client.send(raw);
      }
    }
  }

  private roomKey(candidateToken: string) {
    return `interview:${candidateToken}`;
  }
}
