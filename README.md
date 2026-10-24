# CodeVox 🚀
> **Next-Gen AI-Powered Technical Hiring with AI Interviews & Proctored Assessments**

CodeVox is an end-to-end autonomous technical assessment and recruitment platform engineered to screen, evaluate, and interview engineering talent at scale.

---

## 🏗️ Architecture & Project Structure

```
CodeVox/
├── codevox-backend/          # NestJS API, TypeORM, MySQL, Bull Queues, Python Voice Engine
│   ├── src/                  # Core modules (coding-round, job-profiles, recruitment, etc.)
│   ├── services/voice-engine # Python Voice Microservice (LiveKit WebRTC, Sarvam STT/TTS)
│   ├── sql/                  # Database migration scripts
│   └── .env                  # Backend environment configurations
│
└── codevox-frontend/         # Next.js 15 (App Router), React 19, Monaco Editor, Tailwind CSS
    ├── src/app/              # Next.js routes (assessments, candidate coding, autonomous-interview)
    ├── src/modules/          # Core frontend feature modules
    ├── public/models/        # Pre-trained Face-API proctoring weights & WASM binaries
    └── .env.local            # Frontend environment variables
```

---

## 🌟 Key Features

1. **Autonomous AI Verbal Interview:**
   - Real-time conversational AI interviewer using LiveKit WebRTC and Python Voice Engine.
   - Dynamic adaptive questioning based on candidate responses and tech stack.

2. **Sandboxed Coding Assessment:**
   - Multi-language Monaco IDE (Python, JavaScript, SQL, PHP).
   - Docker containerized sandbox runner for test case execution.

3. **AI Problem Bank Generator:**
   - LLM-powered automatic generation of problems, boilerplates, visible and private test cases.

4. **Live Interview Operations & Monitoring:**
   - Real-time ops dashboard to view ongoing and completed sessions.
   - Silent admin viewport to watch candidate video, audio, and live transcription.

5. **Anti-Cheating Proctoring:**
   - Client-side face tracking (multiple faces, absence, gaze diversion).
   - Fullscreen enforcement and tab-switch logging.

6. **Comprehensive Analytics & Reports:**
   - Automated candidate scoring, test-case pass breakdown, and verbal transcripts.
   - Single-click PDF and Excel (.xlsx) export.

---

## Auth & storage (local)

- **Auth:** Local credentials via NextAuth (no Keycloak). Defaults: `admin@localhost` / `admin`, bearer `local-dev-token` (`LOCAL_AUTH_*` env).
- **Files / recordings:** Local disk under `local-uploads/` and `local-recordings/` (no AWS S3/EC2). Coding take-home runs on Docker only.

## 🚀 Quick Start Guide

### 1. Backend Setup
```bash
cd codevox-backend
npm install
npm run dev
```

### 2. Frontend Setup
```bash
cd codevox-frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

Sign in with `admin@localhost` / `admin` (or your `LOCAL_AUTH_*` values). Set the same `LOCAL_AUTH_TOKEN` in both frontend and backend env.
