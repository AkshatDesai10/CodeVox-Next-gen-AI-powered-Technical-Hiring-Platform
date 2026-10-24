export enum QuestionSourceMode {
  STATIC = 'STATIC',
  AI = 'AI',
  HYBRID = 'HYBRID',
}

export enum EvaluationMode {
  TESTCASE = 'TESTCASE',
  AI = 'AI',
  HYBRID = 'HYBRID',
}

export enum ExperienceLevel {
  JUNIOR = 'JUNIOR',
  MID = 'MID',
  SENIOR = 'SENIOR',
}

export enum QuestionOrigin {
  STATIC = 'STATIC',
  AI_GENERATED = 'AI_GENERATED',
}

export enum EvaluationStrategyType {
  TESTCASE = 'TESTCASE',
  AI = 'AI',
  HYBRID = 'HYBRID',
}

export enum WorkspaceProvisionStatus {
  PROVISIONING = 'PROVISIONING',
  READY = 'READY',
  FAILED = 'FAILED',
  TEARDOWN = 'TEARDOWN',
}
