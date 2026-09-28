# AGENTS.md — EduShare 2.0 (ZAHS LMS)

Server-rendered Express 4 + EJS + MySQL (mysql2/promise) LMS. Views under `src/views/<role>/`, routes `src/routes/<role>Routes.js`, controllers `src/controllers/<role>Controller.js`. No build step, no bundler: `public/js/*.js` are plain scripts loaded by EJS pages. No lint/typecheck scripts — verify by booting the server.

## Commands
- `npm start` — boot (`server.js`). `npm run dev` — nodemon. `npm run init-db` — standalone DB init.
- `npm test` / `test:smoke` / `test:registration` / `test:integration` **currently fail**: the `tests/*.js` files they reference are deleted from the worktree (staged as deletions). Do not rely on them; if you add tests, restore/replace the files and update the script names. `docs/ai-lesson-generation-backend.md` §9 still describes the removed suites.
- Need MySQL (e.g. XAMPP on 3306) reachable before boot — `initDatabase()` runs on `server.js` startup and the app exits on failure.

## DB boot behavior (critical)
`src/config/initDatabase.js` runs on **every boot**: creates the DB, applies `src/config/schema.sql` (idempotent `CREATE ... IF NOT EXISTS`), then migrates existing DBs with **information_schema-gated** blocks, backfills enrollments, and seeds settings + demo accounts. Schema changes therefore need **both**: the CREATE in `schema.sql` for fresh installs **and** a gated block in `initDatabase.js` for existing DBs. There are two distinct gate patterns — don't conflate them:
- **Gated `ALTER TABLE ... ADD COLUMN`** — new columns/enums on existing tables (the status/term/lesson_content columns, the OTP purpose enum). `initDatabase.js` contains 4 of these.
- **Gated `CREATE TABLE`** — whole new tables (`section_transfer_requests`, `student_change_requests`, `notifications`). These are **not** ALTERs, and each also exists in `schema.sql` so fresh installs get it from there. `initDatabase.js` contains 3 of these.
Both follow the same `info_schema` `COUNT(*) = 0` gate. `ALTER ... IF NOT EXISTS` is MariaDB-only — never use it. `src/config/schema.sql` is the single source of truth; there is no duplicate root-level schema export.
- Session store is MySQL-backed (`src/config/sessionStore.js`, `sessions` table, auto-created lazily). Don't use in-memory session assumptions.
- All DB access goes through `src/config/database.js` helpers `query()` / `withTransaction()` — never a raw pool.

## Auth & CSRF (every POST needs it)
- Session-based, role-gated by `requireRole('admin'|'teacher'|'student')` (`src/middleware/auth.js`). `/auth/login` is rate-limited to 20 POSTs/15 min per IP (in-memory store — restarting the server resets it).
- **Every state-changing route must use `validateCsrf`** from `src/middleware/csrf.js`. Multipart routes (multer parses body first) must use `csrfAfterMulter` AFTER `upload.single(...)`. Order matters: `router.post('/x', auth, upload.single('f'), csrfAfterMulter, ctrl)`. Skipping CSRF → 403 (or 429-render of login for `/auth/login`).
- Demo seeds (from `initDatabase.js`, README doesn't list them): admin `admin@edushare.com` / `Admin123!`, teacher `maria.reyes@zahs.edu.ph` / `Teacher123!`, students `jan.samaniego@student.edushare.local` / `alexis.aquilino@student.edushare.local` / `Student123!`. Class code `ENG7RZ`. Seeded rows are only created if absent; passwords won't re-seed on existing DBs.

## AI provider dual-stack (easy to misread)
Order: **9Router** (OpenAI-compatible, default `AI_PRIMARY=nine_router`, base `http://localhost:20128/v1`, model `oc/nemotron-3-ultra-free`) → Ollama (`qwen2.5:7b`) → offline static fallback engine. If `NINE_ROUTER_*` isn't set, it falls to Ollama. Key gotcha: `Ollama /api/embed` (`nomic-embed-text`) is ALWAYS used for RAG curriculum ingestion/quiz grounding — embeddings never go through 9Router. Generic/unrelated AI output usually means the static fallback fired (it never sees the plan/context), e.g. wrong Ollama model name or 9Router key mismatch. See `docs/ai-lesson-generation-backend.md` for the full lesson-generation pipeline.

## Uploads
`src/middleware/upload.js` writes to `storage/uploads/<subdir>` (gitignored) — never to `public/`. The legacy `public/uploads/` directory has been **deleted** and is gitignored as a guard; it is no longer merely unused, because `src/app.js` keeps `express.static` for `public/css|js|images` and therefore anything placed under `public/` would still be served unauthenticated. A deny for `/uploads` is registered immediately *before* the static middleware, so a recreated directory cannot be served — keep that ordering if you touch the static block. All DB-stored paths use the `/files/...` prefix (never `/uploads/...`), so no row can point at the old directory. Files are served authenticated via `GET /files/:subDir/:filename` with per-role ownership checks; filenames are `32-hex` + original ext, and `subDir` must be in the whitelist. Bump multer limits/filters in `upload.js`, not inline. Tooling scratch output (archify workflow renders, `admin-workflow.visual-check.*`) belongs in the gitignored `docs/.tools/` — keep it untracked.

## Conventions
- EJS with `express-ejs-layouts`; default layout `layouts/main`, auth pages must pass `layout: 'layouts/auth'`. New pages: controller renders view + `title`, and all request-scoped flash/branding lives on `res.locals` via `brandingMiddleware`.
- Gradebook weights are DepEd-mandated: WW 20 / PT 50 / QE 30 (`gradebookService.js`).
- Commit style (from git log): conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`) plus milestone tags like `(M3b)`.