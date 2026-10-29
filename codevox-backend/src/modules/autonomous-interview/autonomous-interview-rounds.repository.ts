import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, QueryDeepPartialEntity, Repository } from 'typeorm';
import {
  AutonomousInterviewRoundMysql,
  AutonomousInterviewRoundStatus,
  AutonomousInterviewRoundType,
} from './entities/autonomous-interview-round.mysql.entity';

export function roomNameForRound(
  candidateToken: string,
  roundType: AutonomousInterviewRoundType,
): string {
  return `${candidateToken}_${roundType}`;
}

/** Map voice / job stage signals onto a rounds-table round_type. */
export function resolveRoundType(input: {
  voicePhase?: string | null;
  engine?: string | null;
  stageType?: string | null;
  currentPhase?: string | null;
}): AutonomousInterviewRoundType {
  const candidates = [input.currentPhase, input.voicePhase, input.stageType]
    .map((v) => (v ?? '').trim())
    .filter(Boolean);
  for (const value of candidates) {
    const hit = Object.values(AutonomousInterviewRoundType).find((v) => v === value);
    if (hit) return hit;
  }

  if (input.engine === 'bnd_build') {
    return AutonomousInterviewRoundType.BND_ASSESSMENT;
  }

  const stageType = (input.stageType ?? '').trim();
  if (
    stageType === 'coding' ||
    stageType === 'coding_assessment' ||
    input.currentPhase === 'sandbox_code'
  ) {
    return AutonomousInterviewRoundType.CODING;
  }
  if (stageType === 'project_interview') {
    return AutonomousInterviewRoundType.BND_INTERVIEW;
  }
  if (stageType === 'take_home') {
    return AutonomousInterviewRoundType.BND_ASSESSMENT;
  }
  if (input.engine === 'screening' || stageType === 'ai_screening') {
    return AutonomousInterviewRoundType.AI_SCREENING;
  }
  if (input.engine === 'behavioral' || stageType === 'hr_verbal') {
    return AutonomousInterviewRoundType.HR_VERBAL;
  }
  return AutonomousInterviewRoundType.INTRO_VERBAL;
}

function byCreatedAtAsc(
  a: AutonomousInterviewRoundMysql,
  b: AutonomousInterviewRoundMysql,
): number {
  return +new Date(a.createdAt) - +new Date(b.createdAt);
}

function byUpdatedAtDesc(
  a: AutonomousInterviewRoundMysql,
  b: AutonomousInterviewRoundMysql,
): number {
  return +new Date(b.updatedAt) - +new Date(a.updatedAt);
}

@Injectable()
export class AutonomousInterviewRoundsRepository {
  constructor(
    @InjectRepository(AutonomousInterviewRoundMysql)
    private readonly repo: Repository<AutonomousInterviewRoundMysql>,
  ) {}

  /**
   * Sort in-process. MySQL filesort with large chat_transcript JSON exceeds the
   * default sort_buffer_size (ER_OUT_OF_SORTMEMORY).
   */
  async findByToken(candidateToken: string) {
    const rows = await this.repo.find({ where: { candidateToken } });
    return rows.sort(byCreatedAtAsc);
  }

  findByTokenAndType(candidateToken: string, roundType: AutonomousInterviewRoundType) {
    return this.repo.findOne({ where: { candidateToken, roundType } });
  }

  async ensureRound(
    candidateToken: string,
    roundType: AutonomousInterviewRoundType,
    opts: { livekitRoomName?: string | null } = {},
  ): Promise<AutonomousInterviewRoundMysql> {
    const existing = await this.findByTokenAndType(candidateToken, roundType);
    if (existing) {
      const roomName = opts.livekitRoomName?.trim();
      if (roomName && existing.livekitRoomName !== roomName) {
        await this.repo.update({ id: existing.id }, { livekitRoomName: roomName });
        existing.livekitRoomName = roomName;
      }
      return existing;
    }

    const roomName = opts.livekitRoomName?.trim() || roomNameForRound(candidateToken, roundType);
    return this.repo.save(
      this.repo.create({
        candidateToken,
        roundType,
        livekitRoomName: roomName,
        chatTranscript: null,
        mergedRecordingUrl: null,
        aiScore: null,
        status: AutonomousInterviewRoundStatus.IN_PROGRESS,
        livekitEgressId: null,
        recordingStartedAt: null,
      }),
    );
  }

  async patchRound(
    candidateToken: string,
    roundType: AutonomousInterviewRoundType,
    patch: QueryDeepPartialEntity<AutonomousInterviewRoundMysql>,
  ) {
    await this.ensureRound(candidateToken, roundType);
    await this.repo.update({ candidateToken, roundType }, patch);
    return this.findByTokenAndType(candidateToken, roundType);
  }

  async setMergedRecordingUrl(
    candidateToken: string,
    roundType: AutonomousInterviewRoundType,
    mergedRecordingUrl: string,
  ) {
    return this.patchRound(candidateToken, roundType, { mergedRecordingUrl });
  }

  async setChatTranscript(
    candidateToken: string,
    roundType: AutonomousInterviewRoundType,
    chatTranscript: object | null,
    opts: { status?: AutonomousInterviewRoundStatus; aiScore?: number | null } = {},
  ) {
    return this.patchRound(candidateToken, roundType, {
      chatTranscript: chatTranscript ?? undefined,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.aiScore !== undefined ? { aiScore: opts.aiScore } : {}),
    });
  }

  async findWithMergedRecording(candidateTokens: string[]) {
    const tokens = [...new Set(candidateTokens.filter(Boolean))];
    if (!tokens.length) return [] as AutonomousInterviewRoundMysql[];
    const rows = await this.repo.find({
      where: { candidateToken: In(tokens), mergedRecordingUrl: Not(IsNull()) },
    });
    return rows.sort(byCreatedAtAsc);
  }

  latestMergedUrl(rounds: AutonomousInterviewRoundMysql[]): string | null {
    for (let i = rounds.length - 1; i >= 0; i--) {
      const url = rounds[i]?.mergedRecordingUrl?.trim();
      if (url) return url;
    }
    return null;
  }

  async findWithTranscript(roundTypes: AutonomousInterviewRoundType[]) {
    const rows = await this.repo
      .createQueryBuilder('r')
      .where('r.round_type IN (:...roundTypes)', { roundTypes })
      .andWhere('r.chat_transcript IS NOT NULL')
      .getMany();
    return rows.sort(byUpdatedAtDesc);
  }
}
