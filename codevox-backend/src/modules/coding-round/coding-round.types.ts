export type TestCase = {
  id: string;
  name: string;
  input: string;
  expected_output: string;
  is_visible: boolean; // visible to candidate during run; hidden cases only scored on submit
};

export type StarterCode = Record<string, string>; // language -> code

export type CodingProblem = {
  id: string;
  title: string;
  description_md: string;
  constraints?: string;
  examples?: { input: string; output: string; explanation?: string }[];
  test_cases: TestCase[];
  starter_code?: StarterCode;
};

export type CodingRoundConfig = {
  problems: CodingProblem[];
  languages: string[]; // ['python', 'javascript', 'java', 'cpp', 'go', 'rust']
  time_limit_minutes: number;
};

export const LANGUAGE_DOCKER_IMAGE: Record<string, { image: string; cmd: (file: string) => string[] }> = {
  python: {
    image: 'python:3.11-slim',
    cmd: (f) => ['python', f],
  },
  javascript: {
    image: 'node:20-slim',
    cmd: (f) => ['node', f],
  },
  php: {
    image: 'php:8.2-cli-alpine',
    cmd: (f) => ['php', f],
  },
  sql: {
    image: 'mysql:latest',
    cmd: (f) => [
      'bash',
      '-c',
      `'trap "kill -9 \\$(jobs -p) 2>/dev/null || true" EXIT; mkdir -p /tmp/md && mysqld --initialize-insecure --datadir=/tmp/md >/dev/null 2>&1 && mysqld --datadir=/tmp/md --skip-networking --skip-grant-tables --socket=/tmp/ms --pid-file=/tmp/md/mysqld.pid --mysqlx-socket=/tmp/md/mysqlx.sock >/dev/null 2>&1 & while [ ! -S /tmp/ms ]; do sleep 0.1; done && echo "CREATE DATABASE sandbox; USE sandbox;" > /tmp/run.sql && cat /dev/stdin >> /tmp/run.sql && echo ";" >> /tmp/run.sql && cat ${f} >> /tmp/run.sql && mysql -S /tmp/ms -u root -t < /tmp/run.sql'`
    ]
  }
};

export const LANGUAGE_FILE_EXT: Record<string, string> = {
  python: 'py',
  javascript: 'js',
  php: 'php',
  sql: 'sql'
};

export const DEFAULT_STARTER: Record<string, string> = {
  python: `import sys
import json

def solve(data):
    # TODO: write your solution here
    pass

if __name__ == "__main__":
    raw = sys.stdin.read().strip()
    data = json.loads(raw)
    result = solve(data)
    print(result)`,

  javascript: `process.stdin.resume();
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", d => input += d);
process.stdin.on("end", () => {
    const data = JSON.parse(input.trim());

    function solve(data) {
        // TODO: write your solution here
    }

    const result = solve(data);
    console.log(result);
});`,

  php: `<?php
$raw = trim(stream_get_contents(STDIN));
$data = json_decode($raw, true);

function solve($data) {
    // TODO: write your solution here
}

$result = solve($data);
echo $result . PHP_EOL;
?>`,
  
  sql: `-- Write your SQL query here\n`
};
