#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$ROOT/../.." && pwd)"
cd "$ROOT"

if [[ ! -x .venv/bin/python ]]; then
  echo "Missing .venv — run: npm run voice-engine:setup"
  exit 1
fi

export BACKEND_ROOT
export PORT="${PORT:-8001}"

exec .venv/bin/python - <<'PY'
import os
from pathlib import Path

from dotenv import load_dotenv

backend_root = Path(os.environ["BACKEND_ROOT"])
load_dotenv(backend_root / ".env", override=False)

import uvicorn

uvicorn.run(
    "main:app",
    host="0.0.0.0",
    port=int(os.getenv("PORT", "8001")),
)
PY
