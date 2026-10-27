/**
 * Concise 2-line helper guides for system configurations.
 * Keeps UI lightweight, crisp, and easy to read at a glance.
 */
export const CONFIG_HELP_GUIDES: Record<
  string,
  {
    purpose: string;
    impact: string;
  }
> = {
  FACE: {
    purpose: 'Enforces mandatory face photo capture & identity verification before test entry.',
    impact: 'Turn OFF to skip face capture and only run camera/mic/network readiness check.',
  },
  PROCTOR_ENABLE_MEDIA_STRIKES: {
    purpose: 'Turns media integrity strikes on or off for camera, mic, and screen drops.',
    impact: 'When off, media outages are still logged but do not consume strike budget.',
  },
  PROCTOR_MAX_MEDIA_STRIKES: {
    purpose: 'How many media strikes are allowed in a round before hard action.',
    impact: 'Warnings run through max − 1; the final strike can auto-end the interview.',
  },
  PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE: {
    purpose: 'Whether reaching the media strike limit ends the interview automatically.',
    impact: 'On = terminate session; Off = keep going and only record the strike.',
  },
  PROCTOR_ENABLE_FOCUS_STRIKES: {
    purpose: 'Turns focus integrity strikes on or off for tab switches / leaving fullscreen.',
    impact: 'When off, focus loss is ignored for strike counting.',
  },
  PROCTOR_MAX_FOCUS_STRIKES: {
    purpose: 'How many focus strikes are allowed before hard action.',
    impact: 'Separate budget from media strikes so tab-switching policy can differ.',
  },
  PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE: {
    purpose: 'Whether reaching the focus strike limit ends the interview automatically.',
    impact: 'On = terminate session; Off = keep going and only record the strike.',
  },
  PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS: {
    purpose: 'Seconds of continuous focus loss required before one focus strike is counted.',
    impact: 'Short accidental blurs under this threshold do not add a strike.',
  },
  PROCTOR_GRACE_SECONDS: {
    purpose: 'Grace countdown window (in seconds) to reconnect camera or microphone if lost.',
    impact: 'If hardware is not restored before the timer hits 0, a media strike is logged.',
  },
  LLM_PROVIDER: {
    purpose: 'Primary AI engine used for grading candidate code, answers, and evaluations.',
    impact: 'Switches the underlying model vendor (Gemini, Sarvam, OpenAI, or Claude).',
  },
  GEMINI_MODEL: {
    purpose: 'Specific Google Gemini model version used for assessment evaluations.',
    impact: 'Flash models provide sub-second responses; Pro models offer deeper reasoning.',
  },
  REASONING_EFFORT: {
    purpose: 'Controls Gemini internal thinking deliberation time before answering.',
    impact: 'Use "none" for instant voice turn-taking, or "low/medium" for deep code grading.',
  },
  MAX_TOKENS: {
    purpose: 'Upper token limit for AI-generated evaluations and rubric breakdowns.',
    impact: 'Higher values prevent score notes and code review summaries from truncating.',
  },
  SARVAM_TTS_SPEAKER: {
    purpose: 'Voice persona and accent for the autonomous AI interviewer.',
    impact: '"shubh" delivers natural Indian-accented English/Hindi; "meera" is female voice.',
  },
  SARVAM_TTS_PACE: {
    purpose: 'Speech playback speed rate for the AI interviewer.',
    impact: '0.90 provides clear, natural conversational pacing (range 0.70 to 1.30).',
  },
  RECORDING_MODE: {
    purpose: 'Controls autonomous interview audio recording to AWS S3.',
    impact: '"track" uploads candidate/AI audio for recruiter review; "off" disables recording.',
  },
  GEMINI_API_KEY: {
    purpose: 'Google Gemini API key used for evaluations and grading.',
    impact: 'Paste a new key here to instantly bypass quota exhaustion or rate limits.',
  },
  SARVAM_API_KEY: {
    purpose: 'Sarvam AI key for voice interview speech recognition and audio synthesis.',
    impact: 'Required for real-time speech conversation during AI viva rounds.',
  },
  OPENAI_API_KEY: {
    purpose: 'API key for OpenAI-compatible LLMs, Groq, or fallback models.',
    impact: 'Active when provider is set to OpenAI or during multi-provider failover.',
  },
  DEEPFLAG_API_KEY: {
    purpose: 'Authentication key for DeepFlag AI content detection service.',
    impact: 'Scans written candidate answers to flag AI/ChatGPT-generated text.',
  },
};
