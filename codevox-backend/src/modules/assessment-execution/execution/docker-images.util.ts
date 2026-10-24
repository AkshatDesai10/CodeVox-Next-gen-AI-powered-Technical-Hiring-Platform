/** Default PHP image with pdo_mysql — build via `npm run docker:build-assessment-php`. */
export const DEFAULT_ASSESSMENT_PHP_IMAGE = 'assessment-php:8.3';

/** Default Python image with on-the-fly pip installs — build via `npm run docker:build-assessment-python`. */
export const DEFAULT_ASSESSMENT_PYTHON_IMAGE = 'assessment-python:3.12';

export function resolvePhpDockerImage(): string {
  return process.env.ASSESSMENT_DOCKER_IMAGE_PHP ?? DEFAULT_ASSESSMENT_PHP_IMAGE;
}

export function resolvePythonDockerImage(): string {
  return process.env.ASSESSMENT_DOCKER_IMAGE_PYTHON ?? DEFAULT_ASSESSMENT_PYTHON_IMAGE;
}

export function resolveNodeDockerImage(): string {
  return process.env.ASSESSMENT_DOCKER_IMAGE_NODE ?? 'assessment-node:22';
}

export function resolveSqlDockerImage(): string {
  return (
    process.env.ASSESSMENT_DOCKER_IMAGE_SQL ??
    process.env.ASSESSMENT_DOCKER_IMAGE_PYTHON ??
    DEFAULT_ASSESSMENT_PYTHON_IMAGE
  );
}
