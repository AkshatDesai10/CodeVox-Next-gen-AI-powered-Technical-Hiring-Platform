import { Injectable, Logger } from '@nestjs/common';
import { EgressClient, EgressStatus } from 'livekit-server-sdk';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { TrackSource } from '@livekit/protocol';

export type StartedEgress = {
  egressId: string;
  recordingUrl: string;
  /** `local-recordings/<file>` path under the egress /out mount. */
  storageKey: string;
  mode: 'local';
};

export type EgressLifecycle = 'active' | 'ended' | 'failed' | 'unknown';

export type RoomTrackEgress = {
  egressId: string;
  lifecycle: Exclude<EgressLifecycle, 'unknown'>;
  /** Relative path under local-recordings (egress /out mount). */
  storageKey: string;
  bucket: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
};

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);

  private get config() {
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    const url = process.env.LIVEKIT_URL?.trim() ?? 'ws://192.168.1.3:7880';
    const lanHost = process.env.LIVEKIT_NODE_IP?.trim() || process.env.LIVEKIT_PUBLIC_URL?.trim();
    const publicUrl = (() => {
      try {
        const parsed = new URL(url);
        const loopbackHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
        if (loopbackHosts.has(parsed.hostname) && lanHost) {
          parsed.hostname = lanHost.replace(/^wss?:\/\//, '').split(':')[0];
          return parsed.toString();
        }
        return parsed.toString();
      } catch {
        return url;
      }
    })();
    if (!apiKey || !apiSecret) {
      this.logger.warn('LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set — using dev placeholders');
    }
    return {
      apiKey: apiKey ?? 'devkey',
      apiSecret: apiSecret ?? 'devlocal_livekit_secret_minimum_32b',
      url: publicUrl,
      internalUrl: url,
    };
  }

  // Server-side API calls must hit LIVEKIT_URL directly; the LAN-host rewrite is only for clients.
  private httpUrl() {
    return this.config.internalUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://');
  }

  private egressClient() {
    const { apiKey, apiSecret } = this.config;
    // SDK default is 10s; egress may take longer to claim a job while the host is busy.
    return new EgressClient(this.httpUrl(), apiKey, apiSecret, { requestTimeout: 30 });
  }

  resolveRoomName(candidateToken: string, existing?: string | null) {
    return existing?.trim() || `interview-${candidateToken}`;
  }

  resolveVivaRoomName(vivaToken: string, existing?: string | null) {
    return existing?.trim() || `viva-${vivaToken}`;
  }

  async ensureRoomMetadata(roomName: string, metadata: Record<string, unknown>) {
    const { apiKey, apiSecret } = this.config;
    const client = new RoomServiceClient(this.httpUrl(), apiKey, apiSecret, {
      requestTimeout: 15,
    });
    const meta = JSON.stringify(metadata);

    const sync = async () => {
      const existing = await client.listRooms([roomName]);
      if (existing.length > 0) {
        await client.updateRoomMetadata(roomName, meta);
        return;
      }
      await client.createRoom({ name: roomName, metadata: meta });
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sync();
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const transient = /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|network/i.test(
          message,
        );
        if (!transient || attempt === 2) {
          this.logger.warn(
            `Room metadata update failed for ${roomName}: ${message} (LiveKit API: ${this.httpUrl()})`,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  async createParticipantToken(params: {
    roomName: string;
    identity: string;
    name?: string;
    ttlSeconds?: number;
    canPublish?: boolean;
    canPublishData?: boolean;
    canPublishSources?: TrackSource[];
    hidden?: boolean;
  }) {
    const { apiKey, apiSecret } = this.config;
    const at = new AccessToken(apiKey, apiSecret, {
      identity: params.identity,
      name: params.name ?? params.identity,
      ttl: params.ttlSeconds ?? 60 * 60,
    });
    at.addGrant({
      roomJoin: true,
      room: params.roomName,
      canPublish: params.canPublish ?? true,
      canSubscribe: true,
      canPublishData: params.canPublishData ?? true,
      canUpdateOwnMetadata: true,
      ...(params.canPublishSources?.length
        ? { canPublishSources: params.canPublishSources }
        : {}),
      ...(params.hidden ? { hidden: true } : {}),
    });
    const token = await at.toJwt();
    const rawPublicUrl =
      process.env.LIVEKIT_PUBLIC_URL?.trim() ||
      process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() ||
      this.config.url;
    const publicUrl = rawPublicUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    return { token, url: publicUrl };
  }

  /**
   * Admin monitor token: mic + data publish only (push-to-talk), no camera/screenshare.
   *
   * Do NOT set hidden:true — a hidden publisher's tracks arrive at other clients
   * without a ParticipantInfo, and livekit-client logs
   * "Tried to add a track for a participant, that's not present".
   */
  createMonitorToken(params: {
    roomName: string;
    identity: string;
    name?: string;
    ttlSeconds?: number;
  }) {
    return this.createParticipantToken({
      ...params,
      canPublish: true,
      canPublishData: true,
      canPublishSources: [TrackSource.MICROPHONE],
      hidden: false,
      ttlSeconds: params.ttlSeconds ?? 60 * 60 * 2,
    });
  }

  async listRoomParticipantIdentities(roomName: string): Promise<string[]> {
    const { apiKey, apiSecret } = this.config;
    try {
      const client = new RoomServiceClient(this.httpUrl(), apiKey, apiSecret, {
        requestTimeout: 15,
      });
      const participants = await client.listParticipants(roomName);
      return participants.map((p) => p.identity).filter(Boolean);
    } catch (err) {
      this.logger.warn(
        `listParticipants failed room=${roomName}: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  /**
   * @deprecated Room Composite Egress replaced by per-track egress in the Python voice engine.
   * This method is kept for backward compatibility but now returns null.
   * Track-level egress is managed by the voice-engine's SessionRecorder (recording.py).
   */
  async startRoomCompositeEgress(
    roomName: string,
    token: string,
    opts: { prefix: string },
  ): Promise<StartedEgress | null> {
    void opts;
    this.logger.log(
      `Room Composite Egress SKIPPED (replaced by track egress) room=${roomName} token=${token}`,
    );
    return null;
  }

  /** @deprecated Use voice-engine track egress instead. */
  async startVivaRoomCompositeEgress(roomName: string, vivaToken: string) {
    this.logger.log(
      `Viva Room Composite Egress SKIPPED (replaced by track egress) room=${roomName}`,
    );
    return null;
  }

  /** Detects egresses that ended on their own (room emptied, limit reached, crash). */
  async getEgressStatus(egressId: string): Promise<EgressLifecycle> {
    try {
      const [info] = await this.egressClient().listEgress({ egressId });
      if (!info) return 'ended';
      switch (info.status) {
        case EgressStatus.EGRESS_STARTING:
        case EgressStatus.EGRESS_ACTIVE:
          return 'active';
        case EgressStatus.EGRESS_FAILED:
          return 'failed';
        default:
          return 'ended';
      }
    } catch (err) {
      this.logger.warn(
        `Egress status lookup failed id=${egressId}: ${err instanceof Error ? err.message : err}`,
      );
      return 'unknown';
    }
  }

  /** Per-track file egresses started for a room (by the voice engine), newest data from LiveKit. */
  async listRoomTrackEgresses(roomName: string): Promise<RoomTrackEgress[] | null> {
    let infos;
    try {
      infos = await this.egressClient().listEgress({ roomName });
    } catch (err) {
      this.logger.warn(
        `Egress list failed room=${roomName}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
    const nsToDate = (ns: bigint | number | undefined) =>
      ns && BigInt(ns) > 0n ? new Date(Number(BigInt(ns) / 1_000_000n)) : null;

    const out: RoomTrackEgress[] = [];
    for (const info of infos) {
      if (info.request.case !== 'track' || info.request.value.output.case !== 'file') continue;
      const file = info.fileResults[0];
      let bucket: string | null = null;
      if (file?.location) {
        try {
          const host = new URL(file.location).hostname;
          bucket = host.includes('.s3') ? host.split('.s3')[0] : null;
        } catch {
          /* keep null */
        }
      }
      let lifecycle: RoomTrackEgress['lifecycle'] = 'ended';
      if (
        info.status === EgressStatus.EGRESS_STARTING ||
        info.status === EgressStatus.EGRESS_ACTIVE ||
        info.status === EgressStatus.EGRESS_ENDING
      ) {
        lifecycle = 'active';
      } else if (
        info.status === EgressStatus.EGRESS_FAILED ||
        info.status === EgressStatus.EGRESS_ABORTED
      ) {
        lifecycle = 'failed';
      }
      out.push({
        egressId: info.egressId,
        lifecycle,
        storageKey: (file?.filename || info.request.value.output.value.filepath).replace(/^\/+/, ''),
        bucket,
        startedAt: nsToDate(info.startedAt),
        endedAt: nsToDate(info.endedAt),
      });
    }
    return out;
  }

  async deleteRoom(roomName: string): Promise<void> {
    const name = roomName.trim();
    if (!name) return;
    const { apiKey, apiSecret } = this.config;
    if (!apiKey || !apiSecret) return;
    try {
      const client = new RoomServiceClient(this.httpUrl(), apiKey, apiSecret, {
        requestTimeout: 15,
      });
      await client.deleteRoom(name);
    } catch (err) {
      this.logger.warn(
        `deleteRoom failed room=${name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async stopEgress(egressId: string) {
    try {
      return await this.egressClient().stopEgress(egressId);
    } catch (err) {
      this.logger.warn(
        `Egress stop failed id=${egressId}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
