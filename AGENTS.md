# AGENTS.md — EduShare 2.0 (ZAHS LMS)

Server-rendered Express 4 + EJS + MySQL (mysql2/promise) LMS. Views under `src/views/<role>/`, routes `src/routes/<role>Routes.js`, controllers `src/controllers/<role>Controller.js`. No build step, no bundler: `public/js/*.js` are plain scripts loaded by EJS pages. No lint/typecheck scripts — verify by booting the server.

## Commands
- `npm start` — boot (`server.js`). `npm run dev` — nodemon. `npm run init-db` — standalone DB init.
- `npm test` / `test:smoke` / `test:registration` / `test:integration` **currently fail**: the `tests/*.js` files they reference are deleted from the worktree (staged as deletions). Do not rely on them; if you add tests, restore/replace the files and update the script names. `docs/ai-lesson-generation-backend.md` §9 still describes the removed suites.
- Need MySQL (e.g. XAMPP on 3306) reachable before boot — `initDatabase()` runs on `server.js` startup and the app exits on failure.

## DB boot behavior (critical)
`src/config/initDatabase.js` runs on **every boot**: creates the DB, applies `src/config/schema.sql` (idempotent `CREATE ... IF NOT EXISTS`), then runs **information_schema-gated ALTERs** to migrate existing DBs (status/term/lesson_content columns, OTP purpose enum, `section_transfer_requests`, `student_change_requests`, `notifications` tables), backfills enrollments, and seeds settings + demo accounts. So schema changes need **both**: the CREATE in `schema.sql` for fresh installs **and** a gated ALTER block in `initDatabase.js` for existing DBs — follow the existing `info_schema` `COUNT(*)` gate pattern; `ALTER ... IF NOT EXISTS` is MariaDB-only. The repo-root `edushare-schema.sql` is a duplicate export, not the source of truth.
- Session store is MySQL-backed (`src/config/sessionStore.js`, `sessions` table, auto-created lazily). Don't use in-memory session assumptions.
- All DB access goes through `src/config/database.js` helpers `query()` / `withTransaction()` — never a raw pool.

## Auth & CSRF (every POST needs it)
- Session-based, role-gated by `requireRole('admin'|'teacher'|'student')` (`src/middleware/auth.js`). `/auth/login` is rate-limited to 20 POSTs/15 min per IP (in-memory store — restarting the server resets it).
- **Every state-changing route must use `validateCsrf`** from `src/middleware/csrf.js`. Multipart routes (multer parses body first) must use `csrfAfterMulter` AFTER `upload.single(...)`. Order matters: `router.post('/x', auth, upload.single('f'), csrfAfterMulter, ctrl)`. Skipping CSRF → 403 (or 429-render of login for `/auth/login`).
- Demo seeds (from `initDatabase.js`, README doesn't list them): admin `admin@edushare.com` / `Admin123!`, teacher `maria.reyes@zahs.edu.ph` / `Teacher123!`, students `jan.samaniego@student.edushare.local` / `alexis.aquilino@student.edushare.local` / `Student123!`. Class code `ENG7RZ`. Seeded rows are only created if absent; passwords won't re-seed on existing DBs.

## AI provider dual-stack (easy to misread)
Order: **9Router** (OpenAI-compatible, default `AI_PRIMARY=nine_router`, base `http://localhost:20128/v1`, model `oc/nemotron-3-ultra-free`) → Ollama (`qwen2.5:7b`) → offline static fallback engine. If `NINE_ROUTER_*` isn't set, it falls to Ollama. Key gotcha: `Ollama /api/embed` (`nomic-embed-text`) is ALWAYS used for RAG curriculum ingestion/quiz grounding — embeddings never go through 9Router. Generic/unrelated AI output usually means the static fallback fired (it never sees the plan/context), e.g. wrong Ollama model name or 9Router key mismatch. See `docs/ai-lesson-generation-backend.md` for the full lesson-generation pipeline.

## Uploads
`src/middleware/upload.js` writes to `storage/uploads/<subdir>` (gitignored) — NOT `public/uploads/` (legacy leftover; don't use it). Files are served authenticated via `GET /files/:subDir/:filename` with per-role ownership checks; filenames are `32-hex` + original ext, and `subDir` must be in the whitelist. Bump multer limits/filters in `upload.js`, not inline.

## Conventions
- EJS with `express-ejs-layouts`; default layout `layouts/main`, auth pages must pass `layout: 'layouts/auth'`. New pages: controller renders view + `title`, and all request-scoped flash/branding lives on `res.locals` via `brandingMiddleware`.
- Gradebook weights are DepEd-mandated: WW 20 / PT 50 / QE 30 (`gradebookService.js`).
- Commit style (from git log): conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`) plus milestone tags like `(M3b)`.