# RupAI backend (Phase 1)

The API behind [`rupai-backend-dashboard`](../rupai-backend-dashboard). Jira project **RP1**; the plan is `RupAI/plan.md`.

Tech: Node 24, TypeScript, Express 5, Prisma 7 + MySQL 8.4, zod, pino.

## Run the backend for the frontend (Docker only)

You need Docker Desktop. Nothing else.

```bash
git pull
docker compose up -d --build              # MySQL + API; migrations run on start
docker compose exec api npm run seed      # sample data + the login (safe to run again)
```

- API: `http://localhost:4100/api/v1`
- API docs (every endpoint, body and response; try them out): `http://localhost:4100/docs` — sign in with
  `POST /auth/login` (`admin` / `Admin@12345`), press **Authorize**, paste the `accessToken`. Raw spec: `/docs.json`.
- Health: `http://localhost:4100/health` → `{"status":"ok","database":"ok"}`
- Logs: `docker compose logs -f api`
- Stop: `docker compose down` (data is kept). Start again from scratch: `docker compose down -v`.

In `rupai-backend-dashboard/.env`:

```
VITE_API_URL=http://localhost:4100/api/v1
```

CORS allows `http://localhost:5173` (the dashboard's `npm run dev`).

## Develop on your machine

```bash
cp .env.example .env
npm install
npm run db:up        # MySQL only, on host port 3307
npm run migrate      # apply migrations
npm run seed         # manual seed
npm run dev          # http://localhost:4100
npm run check        # typecheck + lint + format
```

New table: change `prisma/schema.prisma`, then `npm run migrate:new -- --name <what>`, review the SQL in
`prisma/migrations/`, and `npm run migrate:dev`.

## API rules (plan.md §3)

- JSON in and out; dates `YYYY-MM-DD`; ids are strings.
- Errors: `{ "error": { "code", "message", "fields"? } }` with codes `VALIDATION` (400), `UNAUTHENTICATED` (401),
  `NOT_FOUND` (404), `DUPLICATE` (409), `SERVER_ERROR` (500). `fields` is keyed by the form field name.
