# Voice Engine

FastAPI microservice for autonomous interview voice agents (Pipecat/LiveKit) and code submission analytics.

## Endpoints

- `GET /health`
- `POST /api/v1/voice/start-agent` — spawn intro or HR voice agent
- `POST /api/v1/analyze-submission` — score submitted code (delegates to ai-evaluation when available)

## Local run

```bash
cd backend/services/voice-engine
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## Docker (with LiveKit stack)

From repo root:

```bash
docker compose --profile interview up -d livekit redis voice_engine
```

Set `NESTJS_CALLBACK_URL=http://host.docker.internal:3000` and matching `AUTONOMOUS_INTERVIEW_SERVICE_KEY` in NestJS `.env`.
