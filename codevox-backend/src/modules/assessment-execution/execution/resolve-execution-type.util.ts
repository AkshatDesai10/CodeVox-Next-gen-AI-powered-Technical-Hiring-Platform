import type { ExecutionType, Question } from './execution-strategy';
import { readJsonTestCases, isHttpRequestPayload } from '../utils/test-case.util';
import {
  isExplicitHttpTestInput,
  phpSourceUsesHttpInput,
} from '../utils/php-assessment-adapter';

const EXECUTION_TYPE_ALIASES: Record<string, ExecutionType> = {
  SCRIPT: 'SCRIPT',
  HTTP_SERVICE: 'HTTP_SERVICE',
  HTTP: 'HTTP_SERVICE',
  REST: 'HTTP_SERVICE',
  FRAMEWORK_PROJECT: 'FRAMEWORK_PROJECT',
  FRAMEWORK: 'FRAMEWORK_PROJECT',
  DATABASE_ONLY: 'DATABASE_ONLY',
  DATABASE: 'DATABASE_ONLY',
  SQL: 'DATABASE_ONLY',
};

export function normalizeExecutionType(raw: unknown): ExecutionType | null {
  if (raw == null) return null;
  const key = String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return EXECUTION_TYPE_ALIASES[key] ?? null;
}

export function readQuestionExecutionType(question: Question): ExecutionType | null {
  return (
    normalizeExecutionType(question.executionType) ??
    normalizeExecutionType(question.environmentConfig?.executionType) ??
    normalizeExecutionType(question.questionJson?.executionType) ??
    normalizeExecutionType(question.questionJson?.execution_type)
  );
}

function isHttpStyleTestInput(input: unknown): boolean {
  if (isHttpRequestPayload(input)) return true;
  return isExplicitHttpTestInput(input);
}

function questionHasHttpTestCases(question: Question): boolean {
  const jsonCases = readJsonTestCases(question.questionJson, question.evaluationConfig);
  return jsonCases.some((tc) => isHttpStyleTestInput(tc.input));
}

/** Infer strategy when executionType is unset (backward compatible). */
export function resolveExecutionType(
  question: Question,
  language: string,
  sampleInput?: string,
  sourceCode?: string,
): ExecutionType {
  const explicit = readQuestionExecutionType(question);
  if (explicit) return explicit;

  const lang = language.trim().toUpperCase();
  if (lang === 'SQL') return 'DATABASE_ONLY';

  if (sampleInput && isHttpStyleTestInput(sampleInput)) {
    return 'HTTP_SERVICE';
  }

  const workspaceType = String(
    question.workspaceType ??
      question.environmentConfig?.workspaceType ??
      question.questionJson?.workspaceType ??
      '',
  ).toUpperCase();
  if (workspaceType === 'HTTP' || workspaceType === 'REST') {
    return 'HTTP_SERVICE';
  }

  if (questionHasHttpTestCases(question)) {
    return 'HTTP_SERVICE';
  }

  if (lang === 'PHP' && phpSourceUsesHttpInput(sourceCode)) {
    return 'HTTP_SERVICE';
  }

  return 'SCRIPT';
}
