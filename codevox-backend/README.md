# Recruitment Assessment Backend (standalone)

Independent NestJS API for recruitment assessments, job profiles, take-home, and autonomous interviews.

- **Own process / TypeORM connection**
- **Shared MySQL** with the main backend
- **Local credentials auth** (static bearer `LOCAL_AUTH_TOKEN` + shared `user_roles` / `permissions`)
- Recruitment runtime modules live here; main `backend/` keeps only shared entity stubs where needed for joins

## Quick start

```bash
cd recruitment-assessment-backend
cp .env.example .env
npm install
npm run start:dev
```

Health: `GET http://localhost:4000/health`

Admin routes expect `Authorization: Bearer <LOCAL_AUTH_TOKEN>` (default `local-dev-token`). The strategy provisions/loads the local admin user from `LOCAL_AUTH_EMAIL` / `LOCAL_AUTH_NAME` / `LOCAL_AUTH_ADMNO`. Permissions: `assessments:read` / `assessments:write`, `job_profiles:read` / `job_profiles:write`.

Public candidate routes (take-home tokens, autonomous interview join) are token-scoped.
