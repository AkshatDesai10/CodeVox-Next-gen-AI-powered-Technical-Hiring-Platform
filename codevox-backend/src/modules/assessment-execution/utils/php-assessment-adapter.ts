import { readFileSync } from 'fs';
import { join } from 'path';

export type PhpAssessmentRequest = {
  method: string;
  path: string;
  body: string;
  query: Record<string, string>;
  headers: Record<string, string>;
};

export type HttpParseDefaults = {
  defaultMethod?: string;
  defaultPath?: string;
};

const REST_STDIN_RE =
  /^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)(?:\s+([\s\S]+))?$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readField(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return undefined;
}

function serializeHttpBody(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function defaultJsonHeaders(method: string, body: string, headers: Record<string, string>): Record<string, string> {
  const merged = { ...headers };
  if (!body || method === 'GET' || method === 'DELETE') return merged;
  const hasContentType = Object.keys(merged).some(
    (name) => name.toLowerCase() === 'content-type',
  );
  if (!hasContentType && body.trim().startsWith('{')) {
    merged['Content-Type'] = 'application/json';
  }
  return merged;
}

/** Split an optional `?query` suffix from a route path. */
export function splitPathAndQuery(path: string): { path: string; query: Record<string, string> } {
  const qIndex = path.indexOf('?');
  if (qIndex === -1) {
    return { path, query: {} };
  }
  const routePath = path.slice(0, qIndex) || '/';
  const params = new URLSearchParams(path.slice(qIndex + 1));
  const query: Record<string, string> = {};
  params.forEach((value, key) => {
    query[key] = value;
  });
  return { path: routePath, query };
}

/** Generic `/{resource}/{id}` path param extraction. */
export function pathQueryFromRoute(path: string): Record<string, string> {
  const { path: routePath } = splitPathAndQuery(path);
  const query: Record<string, string> = {};
  const idMatch = routePath.match(/\/[^/]+\/([^/]+)/i);
  if (idMatch) {
    query.id = idMatch[1];
  }
  return query;
}

function httpPayloadToPhpRequest(obj: Record<string, unknown>): PhpAssessmentRequest {
  const method = String(readField(obj, 'method', 'Method') ?? 'GET').toUpperCase();
  const rawPath = String(readField(obj, 'path', 'Path') ?? '/');
  const { path, query: pathQuery } = splitPathAndQuery(rawPath);
  const body = serializeHttpBody(readField(obj, 'body', 'Body'));
  const headers: Record<string, string> = {};
  const rawHeaders = readField(obj, 'headers', 'Headers');
  if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [name, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
      if (typeof value === 'string') {
        headers[name] = value;
      }
    }
  }
  const queryField = readField(obj, 'query', 'Query');
  const explicitQuery =
    queryField && typeof queryField === 'object' && !Array.isArray(queryField)
      ? Object.fromEntries(
          Object.entries(queryField as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : {};
  const query = {
    ...pathQueryFromRoute(path),
    ...pathQuery,
    ...explicitQuery,
  };
  return {
    method,
    path,
    body,
    query,
    headers: defaultJsonHeaders(method, body, headers),
  };
}

function wrapBodyAsHttpRequest(
  body: unknown,
  defaults?: HttpParseDefaults,
): PhpAssessmentRequest {
  const method = String(defaults?.defaultMethod ?? 'POST').toUpperCase();
  const path = String(defaults?.defaultPath ?? '/');
  const bodyText = serializeHttpBody(body);
  return {
    method,
    path,
    body: bodyText,
    query: pathQueryFromRoute(path),
    headers: defaultJsonHeaders(method, bodyText, {}),
  };
}

function parseHttpJsonObject(
  obj: Record<string, unknown>,
  defaults?: HttpParseDefaults,
): PhpAssessmentRequest | null {
  const method = readField(obj, 'method', 'Method');
  const path = readField(obj, 'path', 'Path');
  if (method && path) {
    return httpPayloadToPhpRequest(obj);
  }

  const queryField = readField(obj, 'query', 'Query');
  if (queryField && typeof queryField === 'object' && !Array.isArray(queryField)) {
    return {
      method: String(defaults?.defaultMethod ?? 'GET').toUpperCase(),
      path: String(defaults?.defaultPath ?? '/'),
      body: '',
      query: Object.fromEntries(
        Object.entries(queryField as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      ),
      headers: {},
    };
  }

  const wrappedBody = readField(obj, 'body', 'Body');
  if (wrappedBody != null && Object.keys(obj).length === 1) {
    return wrapBodyAsHttpRequest(wrappedBody, defaults);
  }

  return null;
}

/** Defaults for wrapping body-only HTTP test inputs. */
export function readHttpDefaultsFromQuestion(question?: {
  environmentConfig?: Record<string, unknown> | null;
  questionJson?: Record<string, unknown> | null;
} | null): HttpParseDefaults {
  const env = question?.environmentConfig ?? {};
  const json = question?.questionJson ?? {};
  const environment =
    json.environment && typeof json.environment === 'object'
      ? (json.environment as Record<string, unknown>)
      : {};
  return {
    defaultMethod: String(
      env.httpMethod ?? json.httpMethod ?? environment.httpMethod ?? 'POST',
    ).toUpperCase(),
    defaultPath: String(
      env.httpPath ?? json.httpPath ?? json.apiPath ?? environment.httpPath ?? '/',
    ),
  };
}

function parseQueryStringFromInput(raw: string): PhpAssessmentRequest | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('?')) {
    const params = new URLSearchParams(trimmed.slice(1));
    const query: Record<string, string> = {};
    params.forEach((value, key) => {
      query[key] = value;
    });
    if (!Object.keys(query).length) return null;
    return {
      method: 'GET',
      path: '/',
      body: '',
      query,
      headers: {},
    };
  }

  if (trimmed.startsWith('/') && trimmed.includes('?')) {
    const { path, query } = splitPathAndQuery(trimmed);
    if (!Object.keys(query).length) return null;
    return {
      method: 'GET',
      path,
      body: '',
      query,
      headers: {},
    };
  }

  if (trimmed.includes('=') && !/^(GET|POST|PUT|DELETE|PATCH)\s+/i.test(trimmed)) {
    const params = new URLSearchParams(trimmed);
    const query: Record<string, string> = {};
    params.forEach((value, key) => {
      query[key] = value;
    });
    if (Object.keys(query).length) {
      return {
        method: 'GET',
        path: '/',
        body: '',
        query,
        headers: {},
      };
    }
  }

  return null;
}

function parsePhpRestLine(stdin?: string): PhpAssessmentRequest | null {
  const raw = stdin?.trim();
  if (!raw || !REST_STDIN_RE.test(raw)) return null;

  const match = raw.match(REST_STDIN_RE);
  if (!match) return null;

  const method = match[1].toUpperCase();
  const rawPath = match[2];
  const body = (match[3] ?? '').trim();
  const { path, query: pathQuery } = splitPathAndQuery(rawPath);

  return {
    method,
    path,
    body,
    query: { ...pathQueryFromRoute(path), ...pathQuery },
    headers: {},
  };
}

/** Parse REST stdin as a line, JSON HTTP payload, or body-only JSON object. */
export function parsePhpAssessmentStdin(
  stdin?: string,
  defaults?: HttpParseDefaults,
): PhpAssessmentRequest | null {
  const raw = stdin?.trim();
  if (!raw) return null;

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const parsed = parseHttpJsonObject(obj, defaults);
      if (parsed) return parsed;
    } catch {
      // fall through
    }
  }

  const queryOnly = parseQueryStringFromInput(raw);
  if (queryOnly) return queryOnly;

  return parsePhpRestLine(stdin);
}

/** True when test input is explicitly HTTP-shaped (not plain stdin JSON). */
export function isExplicitHttpTestInput(input: unknown): boolean {
  if (input == null) return false;
  if (isPlainObject(input)) {
    if (readField(input, 'method', 'Method') && readField(input, 'path', 'Path')) return true;
    const queryField = readField(input, 'query', 'Query');
    if (queryField && typeof queryField === 'object' && !Array.isArray(queryField)) return true;
    const bodyOnly = readField(input, 'body', 'Body');
    if (bodyOnly != null && Object.keys(input).length === 1) return true;
    return false;
  }
  if (typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (REST_STDIN_RE.test(trimmed)) return true;
  if (parseQueryStringFromInput(trimmed)) return true;
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (!isPlainObject(obj)) return false;
      if (readField(obj, 'method', 'Method') && readField(obj, 'path', 'Path')) return true;
      const queryField = readField(obj, 'query', 'Query');
      if (queryField && typeof queryField === 'object' && !Array.isArray(queryField)) return true;
      const bodyOnly = readField(obj, 'body', 'Body');
      if (bodyOnly != null && Object.keys(obj).length === 1) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Parse HTTP test input from a string or structured JSON value. */
export function parseHttpTestCaseInput(
  input: unknown,
  defaults?: HttpParseDefaults,
): PhpAssessmentRequest | null {
  if (input == null) return null;
  if (typeof input === 'string') return parsePhpAssessmentStdin(input, defaults);
  if (isPlainObject(input)) return parseHttpJsonObject(input, defaults);
  return null;
}

/**
 * Parse test input for HTTP_SERVICE execution.
 * Falls back to wrapping plain JSON as a POST body when the question is already HTTP-routed.
 */
export function parseHttpTestCaseInputForExecution(
  input: unknown,
  defaults?: HttpParseDefaults,
): PhpAssessmentRequest | null {
  const explicit = parseHttpTestCaseInput(input, defaults);
  if (explicit) return explicit;

  if (typeof input === 'string' && input.trim().startsWith('{')) {
    try {
      return wrapBodyAsHttpRequest(JSON.parse(input.trim()) as Record<string, unknown>, defaults);
    } catch {
      return null;
    }
  }
  if (isPlainObject(input) && !isExplicitHttpTestInput(input)) {
    return wrapBodyAsHttpRequest(input, defaults);
  }
  return null;
}

export type VfsSubmission = {
  entryFile: string;
  files: Record<string, string>;
};

/** Parse an IDE virtual-filesystem JSON snapshot. */
export function parseVfsSubmission(sourceCode: string): VfsSubmission | null {
  const trimmed = sourceCode.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.__vfs !== true || !parsed.files || typeof parsed.files !== 'object') {
      return null;
    }
    const files: Record<string, string> = {};
    for (const [path, value] of Object.entries(parsed.files as Record<string, unknown>)) {
      if (typeof value === 'string') files[path] = value;
    }
    if (!Object.keys(files).length) return null;
    const entryFile = typeof parsed.entryFile === 'string' ? parsed.entryFile : 'Main.php';
    return { entryFile, files };
  } catch {
    return null;
  }
}

/** Extract the entry file from an IDE virtual-filesystem JSON snapshot. */
export function resolveSubmissionSourceCode(sourceCode: string): string {
  const vfs = parseVfsSubmission(sourceCode);
  if (!vfs) return sourceCode;
  const entrySource = vfs.files[vfs.entryFile];
  if (typeof entrySource === 'string' && entrySource.trim()) {
    return entrySource;
  }
  for (const value of Object.values(vfs.files)) {
    if (value.trim()) return value;
  }
  return sourceCode;
}

/** PHP that reads web superglobals must run behind `php -S`, not CLI. */
export function phpSourceUsesHttpInput(sourceCode?: string): boolean {
  const resolved = resolveSubmissionSourceCode(sourceCode ?? '');
  if (!resolved.trim()) return false;
  return /\$_((GET)|(POST)|(REQUEST)|(SERVER))|\bgetallheaders\s*\(/i.test(resolved);
}

/** @deprecated Use parsePhpAssessmentStdin */
export function parsePhpAssessmentInput(stdin?: string): PhpAssessmentRequest | null {
  return parsePhpAssessmentStdin(stdin);
}

/** Serialize the original assessment test input for STDIN (full HTTP envelope when applicable). */
export function serializeStdinPayloadForRunner(
  rawInput: string,
  request: PhpAssessmentRequest,
): string {
  const trimmed = rawInput.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (readField(parsed, 'method', 'Method') && readField(parsed, 'path', 'Path')) {
        return trimmed;
      }
    } catch {
      // synthesize below
    }
  }

  let body: unknown = request.body;
  if (request.body.trim().startsWith('{')) {
    try {
      body = JSON.parse(request.body);
    } catch {
      body = request.body;
    }
  } else if (request.body.trim().startsWith('[')) {
    try {
      body = JSON.parse(request.body);
    } catch {
      body = request.body;
    }
  }

  const payload: Record<string, unknown> = {
    method: request.method,
    path: request.path,
    body,
  };
  if (Object.keys(request.query).length) {
    payload.query = request.query;
  }
  return JSON.stringify(payload);
}

/** Serialize an HTTP request for the runner harness (request.json shape). */
export function serializeRequestForRunner(request: PhpAssessmentRequest): string {
  return JSON.stringify({
    method: request.method,
    path: request.path,
    query: request.query,
    headers: request.headers,
    body:
      request.body && request.body.trim().startsWith('{')
        ? JSON.parse(request.body)
        : request.body || null,
  });
}

/** Parse serialized runner request JSON back into PhpAssessmentRequest. */
export function deserializeRequestFromRunner(json: string): PhpAssessmentRequest | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (!obj.method || !obj.path) return null;
    return httpPayloadToPhpRequest(obj);
  } catch {
    return null;
  }
}

/**
 * Candidate source is never rewritten to redirect DB connections or input streams.
 * @deprecated Kept for backward-compatible API — returns submission unchanged.
 */
export function adaptPhpSourceForAssessment(sourceCode: string): string {
  const code = sourceCode.trim();
  if (!code.startsWith('<?php')) {
    return `<?php\n${code}`;
  }
  return code;
}

let cachedBootstrap: string | null = null;

const FALLBACK_PHP_RUNNER_BOOTSTRAP = `<?php
declare(strict_types=1);
if (PHP_SAPI === 'cli-server') {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if ($path === '/.well-known/assessment-health') {
        http_response_code(204);
        exit;
    }
}
if (!function_exists('getallheaders')) {
    function getallheaders(): array {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (!is_string($name) || !is_string($value)) continue;
            if (str_starts_with($name, 'HTTP_')) {
                $headers[str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))))] = $value;
            }
        }
        return $headers;
    }
}
if (!defined('STDIN')) {
    $stdinContent = '';
    $rawInput = file_get_contents('php://input');
    if (is_string($rawInput) && $rawInput !== '') {
        $stdinContent = $rawInput;
    } elseif (!empty($_GET)) {
        $stdinContent = count($_GET) === 1 ? (string) reset($_GET) : http_build_query($_GET);
    }
    $stdinStream = fopen('php://memory', 'rb+');
    if ($stdinStream === false) {
        define('STDIN', fopen('php://input', 'r'));
    } else {
        fwrite($stdinStream, $stdinContent);
        rewind($stdinStream);
        define('STDIN', $stdinStream);
    }
}
if (!defined('STDOUT')) define('STDOUT', fopen('php://output', 'w'));
if (!defined('STDERR')) define('STDERR', fopen('php://stderr', 'w'));
$target = __DIR__ . '/Main.php';
if (!is_file($target)) $target = __DIR__ . '/index.php';
require $target;
`;

export function readPhpRunnerBootstrap(): string {
  if (cachedBootstrap) return cachedBootstrap;
  const candidates = [
    join(__dirname, 'php_runner_bootstrap.php'),
    join(process.cwd(), 'src/modules/assessment-execution/utils/php_runner_bootstrap.php'),
  ];
  for (const candidate of candidates) {
    try {
      cachedBootstrap = readFileSync(candidate, 'utf8');
      return cachedBootstrap;
    } catch {
      // try next path
    }
  }
  cachedBootstrap = FALLBACK_PHP_RUNNER_BOOTSTRAP;
  return cachedBootstrap;
}

/** @deprecated Import readPhpRunnerBootstrap() — lazy-read bootstrap PHP router. */
export const PHP_RUNNER_BOOTSTRAP = readPhpRunnerBootstrap();

let cachedNodeBootstrap: string | null = null;

export function readNodeRunnerBootstrap(): string {
  if (cachedNodeBootstrap) return cachedNodeBootstrap;
  const candidates = [
    join(__dirname, 'node_runner_bootstrap.js'),
    join(process.cwd(), 'src/modules/assessment-execution/utils/node_runner_bootstrap.js'),
  ];
  for (const candidate of candidates) {
    try {
      cachedNodeBootstrap = readFileSync(candidate, 'utf8');
      return cachedNodeBootstrap;
    } catch {
      // try next path
    }
  }
  throw new Error('node_runner_bootstrap.js not found in assessment execution utils');
}
