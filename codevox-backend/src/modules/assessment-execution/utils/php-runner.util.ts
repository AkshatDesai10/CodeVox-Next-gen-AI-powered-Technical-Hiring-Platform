/** Backward-compatible re-exports — implementations live in php-assessment-adapter.ts */
export {
  adaptPhpSourceForAssessment,
  deserializeRequestFromRunner,
  parsePhpAssessmentInput,
  parsePhpAssessmentStdin,
  PHP_RUNNER_BOOTSTRAP,
  readPhpRunnerBootstrap,
  serializeRequestForRunner,
  type PhpAssessmentRequest,
} from './php-assessment-adapter';
