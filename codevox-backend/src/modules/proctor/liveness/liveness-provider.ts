export type LivenessVerifyPayload = {
  challenge_id: string;
  passed: boolean;
  motion_score?: number;
  steps_completed?: string[];
  vendor_session_id?: string;
};

export interface LivenessProvider {
  readonly name: 'challenge' | 'vendor';
  validate(payload: LivenessVerifyPayload): { valid: boolean; reason?: string };
}

export class ChallengeLivenessProvider implements LivenessProvider {
  readonly name = 'challenge' as const;

  validate(payload: LivenessVerifyPayload): { valid: boolean; reason?: string } {
    if (!payload.passed) {
      return { valid: false, reason: 'Liveness challenge not passed' };
    }
    const motion = payload.motion_score ?? 0;
    if (motion < 0.15) {
      return { valid: false, reason: 'Insufficient motion detected (possible static image)' };
    }
    if (!payload.steps_completed?.length) {
      return { valid: false, reason: 'No challenge steps recorded' };
    }
    return { valid: true };
  }
}

/** Placeholder for AWS Rekognition / FaceTec — enabled via interview_global_config.liveness_provider */
export class VendorLivenessProvider implements LivenessProvider {
  readonly name = 'vendor' as const;

  validate(payload: LivenessVerifyPayload): { valid: boolean; reason?: string } {
    if (!payload.passed) {
      return { valid: false, reason: 'Vendor liveness session failed' };
    }
    if (!payload.vendor_session_id?.trim()) {
      return { valid: false, reason: 'Missing vendor liveness session id' };
    }
    return { valid: true };
  }
}

export function resolveLivenessProvider(
  provider: 'challenge' | 'vendor',
): LivenessProvider {
  if (provider === 'vendor') return new VendorLivenessProvider();
  return new ChallengeLivenessProvider();
}
