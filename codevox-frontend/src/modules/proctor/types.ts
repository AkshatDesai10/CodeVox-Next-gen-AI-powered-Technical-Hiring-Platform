export type ProctorEventInput = {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  payload?: Record<string, unknown>;
  client_ts?: number;
};

export type ProctorConfig = {
  faceCheckIntervalMs: number;
  faceMatchThreshold: number;
  requireCameraForStart: boolean;
  requireVoiceEnroll?: boolean;
};
