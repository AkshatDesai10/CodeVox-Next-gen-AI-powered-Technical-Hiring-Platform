/** LiveKit data-channel protocol for recruiter push-to-talk intervention. */

export const PROCTOR_INTERVENTION_TYPE = 'PROCTOR_INTERVENTION' as const;
export const PROCTOR_TELEMETRY_TYPE = 'PROCTOR_TELEMETRY' as const;

export type ProctorInterventionAction = 'PAUSE' | 'RESUME';

export type ProctorInterventionMessage = {
  type: typeof PROCTOR_INTERVENTION_TYPE;
  action: ProctorInterventionAction;
  timestamp: number;
  admin?: string;
};

export type ProctorTelemetryMessage = {
  type: typeof PROCTOR_TELEMETRY_TYPE;
  timestamp: number;
  strikeCount: number;
  maxStrikes: number;
  lookingAway: boolean;
  multiFace: boolean;
  multiFaceAt?: string | null;
  mediaOutage: boolean;
  graceSecondsLeft: number;
};

export function encodeProctorData(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function parseProctorData(payload: Uint8Array): Record<string, unknown> | null {
  try {
    const text = new TextDecoder().decode(payload);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isProctorIntervention(
  data: Record<string, unknown> | null,
): data is ProctorInterventionMessage {
  return (
    !!data &&
    data.type === PROCTOR_INTERVENTION_TYPE &&
    (data.action === 'PAUSE' || data.action === 'RESUME')
  );
}

export function isProctorTelemetry(
  data: Record<string, unknown> | null,
): data is ProctorTelemetryMessage {
  return !!data && data.type === PROCTOR_TELEMETRY_TYPE;
}
