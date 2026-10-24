'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WORKSPACE = '/workspace';
const PORT = Number(process.env.ASSESSMENT_HTTP_PORT || 8080);

function readStdinPayload() {
  const testInputPath = path.join(WORKSPACE, 'test-input.txt');
  if (fs.existsSync(testInputPath)) {
    return fs.readFileSync(testInputPath, 'utf8');
  }

  const requestPath = path.join(WORKSPACE, 'request.json');
  if (!fs.existsSync(requestPath)) {
    return '';
  }

  try {
    const payload = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    if (!payload || typeof payload !== 'object') return '';

    if (payload.body != null) {
      return typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body);
    }

    if (payload.query && typeof payload.query === 'object') {
      const keys = Object.keys(payload.query);
      if (keys.length === 1) {
        return String(payload.query[keys[0]]);
      }
      return new URLSearchParams(
        Object.entries(payload.query).map(([key, value]) => [key, String(value)]),
      ).toString();
    }
  } catch {
    return '';
  }

  return '';
}

function resolveEntryFile() {
  for (const candidate of ['index.js', 'main.js']) {
    if (fs.existsSync(path.join(WORKSPACE, candidate))) {
      return candidate;
    }
  }
  return 'index.js';
}

function runCandidate(stdinPayload) {
  return new Promise((resolvePromise) => {
    const entryFile = resolveEntryFile();
    const child = spawn('node', [path.join(WORKSPACE, entryFile)], {
      cwd: WORKSPACE,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      resolvePromise({ stdout, stderr, code: code ?? 1 });
    });
    child.on('error', (error) => {
      resolvePromise({ stdout: '', stderr: String(error), code: 1 });
    });

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/.well-known/assessment-health') {
    res.writeHead(204);
    res.end();
    return;
  }

  const result = await runCandidate(readStdinPayload());
  if (result.code !== 0 && result.stderr) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(result.stderr.trim() || result.stdout.trim());
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(result.stdout.trim());
});

server.listen(PORT, '0.0.0.0');
