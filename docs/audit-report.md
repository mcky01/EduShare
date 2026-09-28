Investigation is complete — all ten categories have verified findings. Here is the audit.
EduShare 2.0 Static Audit Report
Repository: C:\Users\alexi\Downloads\EduShare2.0
Branch: improvedQuiz @ d80ec0e (identical to origin/improvedQuiz)
Worktree: clean — no files were modified
Method: read-only static inspection (git, Node resolution checks, SQL extraction, route/URL cross-referencing)
Limitations: MySQL was not reachable in this environment, so the server was never booted and the database was not inspected. No browser session was available. Dynamic (template-interpolated) URL segments and live database contents are not statically provable. This clone is byte-identical to origin/improvedQuiz; anything that existed only in the failed laptop's uncommitted work is not recoverable from here — but see Category 9 #6, the deleted test suites are recoverable.
Summary
Severity	Rows
Critical	6
Warning	23
Note	38
Total	67
Category
1. Structure & Files
2. Entry Points & Startup
3. Dependencies
4. Environment & Secrets
5. Routes vs. Controllers
6. Schema Drift
7. Frontend–Backend Contracts
8. Dead Code & Orphans
9. Git & Housekeeping
10. Documentation
The 6 Critical rows trace to 4 root causes: the broken pptxService import (Cat 2 + Cat 7), the deleted test suites (Cat 1 + Cat 10), and the SMTP env-key mismatch (Cat 4).
Category 1 — Repository Structure & File Layout
#	Location	Finding
1	tests/ (empty dir)	All 3 test suites were deleted in commit f6e410e. The directory has 0 files, so npm test, test:smoke, test:registration, and test:integration all fail with MODULE_NOT_FOUND.
2	scripts/ (repo root)	Zero files, untracked, no defined role. The real maintenance CLIs live in src/scripts/.
3	src/views/images/ClassroomBG.jpeg	2,008,874 B, SHA-256 identical to public/images/ClassroomBG.png, and referenced by 0 EJS views and 0 JS files.
4	edushare-schema.sql (root)	687-line standalone dump: CREATE DATABASE + the same 34 tables + demo seed rows. The canonical schema is src/config/schema.sql (532 lines). Identical table sets today, but two copies will drift.
5	public/uploads/	Legacy path — src/middleware/upload.js:6 writes to storage/uploads/. It is still served publicly by express.static (src/app.js:99) and still contains a real uploaded avatar (public/uploads/avatars/avatar-1788973814599-665151116.png). Anything placed there is unauthenticated.
6	src/scripts/importCuratedJson.js:2	Usage comment says node src/scripts/importCuratedJson.js "../Resources/CG English 7.json". No such file exists — the real path is Resources/CG/CG English 7.json.
7	src/views/partials/footer.ejs:1	Comment-only stub (<!-- Footer slot reserved. -->), included by 0 layouts.
8	repo root	There is no root app.js; the entry chain is server.js:9 → src/app.js. The audit assumption of a root app.js is incorrect.
9	.tmp-npm-cache/	15.6 MB local npm cache at repo root; correctly ignored via .gitignore:8 (.tmp-*/).
10	src/views/{admin,teacher,student}/	Identical basenames across role dirs (dashboard.ejs ×3, class-detail.ejs ×2, gradebook.ejs ×2, …). This is intentional and resolved by the per-role router mounts.
Category 2 — Entry Points & Startup
#	Location	Finding
1	src/controllers/aiController.js:889 and :897	require('./pptxService') resolves to src/controllers/pptxService.js, which does not exist. The real module is src/services/pptxService.js (142 lines, fully implemented). Requiring the controller throws MODULE_NOT_FOUND; the error is caught and POST /api/ai/lesson/export-pptx returns 500.
2	package.json:10-13	test, test:smoke, test:registration, test:integration all point at tests/*.js files that do not exist.
3	package.json:5-9,15	main: "server.js" ✓ exists; scripts.start: "node server.js" ✓; scripts["init-db"]: "node src/config/initDatabase.js" ✓ works because of the require.main === module guard at initDatabase.js:571.
4	server.js:31	Boot banner hardcodes AI Provider: Local Ollama (${env.OLLAMA_MODEL}), but the default primary is 9Router (env.js:33-40, .env.example:20-28). Misleading operator output.
5	package.json	No engines field and no .nvmrc; README claims Node 18+. The Node version on the failed laptop is unknown.
6	audit environment	MySQL was unreachable, so npm start was not executed. Entry-point resolution was verified statically instead (server.js:9-11, src/app.js:1-24 — all imports resolve).
Category 3 — Dependency Management
#	Location	Finding
1	package.json:39	nodemailer is declared but never required anywhere. src/services/mailService.js:1-47 hand-rolls SMTP + STARTTLS over net/tls. Unused ~2 MB dependency and avoidable supply-chain surface.
2	package.json ↔ package-lock.json ↔ node_modules	All 16 runtime dependencies are declared, every lockfile range is satisfied, and installed versions match the lock exactly (express 4.22.2, mysql2 3.24.4, multer 1.4.5-lts.2, pdf-parse 2.4.5, …). No missing, undeclared, or mismatched dependency.
3	package.json:30	ejs is never required — correct, since Express resolves it via app.set('view engine', 'ejs') (src/app.js:90). Recorded so it is not "fixed".
4	package.json:33	nodemon is the only devDependency; there is no linter, formatter, or test-runner dependency. Consistent with AGENTS.md.
5	package.json:35 (pdf-parse: ^2.4.5)	v2 is "type": "module" and drops the v1 callable API. Both call sites already handle it correctly: pdfTextService.js:13-22 tries the v1 function then falls back to the v2 PDFParse class, and planParseService.js:388 requires the class directly. Verified require('pdf-parse') succeeds and exposes PDFParse.
Category 4 — Environment & Secrets
#	Location	Finding
1	.env.example:45-51 vs src/config/env.js:56-61	The template defines EMAIL_HOST / EMAIL_PORT / EMAIL_SECURE / EMAIL_USER / EMAIL_PASS / EMAIL_FROM, and no code reads any of them. The app reads SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM. Neither .env.example nor the active .env defines the SMTP_* names, so mailService.js:60 throws SMTP credentials not configured and every OTP / forgot-password email fails. It only appears to work because .env sets OTP_DEV_LOG=true, which short-circuits at mailService.js:55-58 and prints the code to stdout.
2	.env.example (ends at line 51)	Five code-read variables are absent from the template: FRONTEND_ORIGINS (src/app.js:47), OLLAMA_EMBED_MODEL (env.js:43), RAG_TOPK (:44), RAG_PREFILTER_LIMIT (:45), RAG_MIN_SCORE (:46). All have safe defaults so nothing breaks at boot, but a fresh clone cannot enable CORS or tune RAG from the template.
3	.env (untracked)	Missing the same five variables and all SMTP_* keys, so MAIL_FROM falls back to EduShare <noreply@zahs.edu.ph>.
4	src/services/mailService.js:64-73; src/services/otpService.js	sendMail calls console.log unconditionally, writing full message content and recipient addresses, and holds a 10s setTimeout per send. With OTP_DEV_LOG=true this writes OTPs into logs; even in production it PII-logs every message.
5	.gitignore:6, git ls-files	.env is correctly ignored and untracked. SESSION_SECRET is a real 58-character value, not a placeholder. NODE_ENV=development.
6	tracked tree	No hardcoded secrets found. The .env NINE_ROUTER_API_KEY is set but untracked. edushare-schema.sql:603,607 are bcrypt hashes, and docs/superpowers/plans/2026-09-09-self-registration-otp.md:494 holds a test fixture password — neither is a live secret.
7	src/config/env.js:14-17	SESSION_SECRET falls back to a hardcoded dev string and only throws when NODE_ENV === 'production'. Correct fail-fast design; recorded as a deployment gate.
Category 5 — Routes vs. Controllers
#	Location	Finding
1	enrollmentService.js:68,82,117-118; groundingService.js:301,314; planParseService.js:303; validationService.js:10; adminInterventionController.js:1287,1486	Six exported functions are never called from any route, controller, service, view, or script: autoEnrollUser, backfillMissingEnrollments, normalizeTerm, filterTaggedForSession, topicAlignment, describeChange.
2	src/config/initDatabase.js:134-172 vs src/services/enrollmentService.js:82	The boot-time enrollment backfill is implemented twice — inline in initDatabase.js and as the dead enrollmentService.backfillMissingEnrollments(). The two copies can silently diverge.
3	src/controllers/adminController.js:715 (exportGradebook)	A delegated stub with no route — adminRoutes.js:31 registers only exportGradebookPost.
4	src/middleware/upload.js:8,137 (ALLOWED_DOC_EXTS)	Exported but unused; src/routes/filesRoutes.js:12 declares its own inline regex. Two sources of truth for allowed document extensions.
5	src/controllers/authController.js:881,967 (doResetPassword)	Exported but only ever invoked internally at :881; no route binds it.
6	all 9 files in src/routes/	Every route handler resolves to a real controller export — verified programmatically against all router.get/post/put/delete/patch calls plus the 2 app.get/app.post handlers in src/app.js. No missing handler.
Category 6 — Schema Drift
#	Location	Finding
1	src/config/schema.sql:334 (mirrored at edushare-schema.sql:370)	The attendance table is created on every boot but never read or written by any controller, service, view, initDatabase.js, or JS asset — 0 hits outside the two schema files.
2	all 34 tables	Every table referenced by controllers and services exists in src/config/schema.sql. No missing table.
3	src/config/initDatabase.js:99-133	The information_schema-gated ALTERs (eight ADD COLUMN migrations) target columns that already exist in schema.sql; they are legacy-DB-only migrations, correctly gated behind a COUNT(*) = 0 check. Consistent with AGENTS.md.
4	audit environment	Column-level drift inside an existing database could not be verified without MySQL. Only the SQL source of truth was compared.
Category 7 — Frontend–Backend Contracts
#	Location	Finding
1	POST /api/ai/lesson/export-pptx	The wire contract is correct on both sides — aiRoutes.js:35 → aiController.js:881, and public/js/lesson-wizard.js:904 POSTs to it — but the handler 500s because of the broken require('./pptxService') (Cat 2 #1). The contract matches; the feature is dead.
2	18 fetch() sites in public/js/*.js + all EJS form action= / in-app href=	Every literal method+path resolves to a live route. No orphan endpoint references and no missing backend routes. Dynamic IDs and template-concatenated paths are not statically provable.
3	resources/ (tracked, ~118 KB)	Contains only lessons-7.json; referenced by no route, controller, or view. The Resources/ curriculum drop is loaded solely by the manual CLI src/scripts/importCuratedJson.js.
Category 8 — Dead Code & Orphans
#	Location	Finding
1	src/views/images/ClassroomBG.jpeg	2,008,874 B orphan, byte-identical to the referenced public/images/ClassroomBG.png, with 0 references.
2	six unused exports	Detailed in Cat 5 #1 — autoEnrollUser, backfillMissingEnrollments, normalizeTerm, filterTaggedForSession, topicAlignment, describeChange.
3	src/services/pptxService.js	142 lines of fully implemented code, unreachable because of the wrong-path require at aiController.js:889,897.
4	src/views/partials/footer.ejs:1	Comment-only stub, included by 0 layouts.
5	src/scripts/reportBrokenQuizAnswers.js	A DB-mutating maintenance CLI supporting --fix, with no package.json script and no README/AGENTS.md mention.
6	src/scripts/importCuratedJson.js	Same — undocumented CLI, and its usage comment is also wrong (Cat 1 #6).
7	src/config/schema.sql	Appears as "never require()d" in a naive require-graph scan; it is in fact loaded via fs.readFileSync at initDatabase.js:25-27. Not an orphan — recorded so the scan result is not misread.
Category 9 — Git & Housekeeping
#	Location	Finding
1	.gitignore:11-12	public/uploads/**/* also matches the public/uploads/avatars directory itself, so git never descends into it and the !public/uploads/**/.gitkeep negation cannot re-include nested placeholders. git check-ignore -v confirms only the top-level public/uploads/.gitkeep is tracked.
2	branch state	improvedQuiz matches origin/improvedQuiz (0 ahead / 0 behind), but the local main is behind origin/main (1 2) and origin/main (1a5fb4d) is not an ancestor of improvedQuiz. origin/main uniquely holds tests/smoke-test.js, tests/registration-test.js, tests/integration-test.js, and AGENTS.md.
3	large tracked binaries	~7.03 MB of images: public/images/zahs-logo.png (3,014,854 B), public/images/ClassroomBG.png (2,008,874 B), and the orphan src/views/images/ClassroomBG.jpeg (2,008,874 B).
4	docs/admin-workflow.html (632,948 B) + 4 *.visual-check.*.png (121,925 / 128,007 / 159,235 / 167,741 B) + 2 JSON (77,363 / 4,232 B)	~1.21 MB of archify 2.14.0 tool output committed into docs/, referenced by no documentation.
5	tests/, scripts/ (empty)	Git cannot track empty directories, so both are absent from every clone. scripts/ is not in .gitignore, so it reappears as an untracked empty directory on any machine.
6	.gitignore:6,22-23	.env is ignored and untracked; storage/ is ignored and untracked. No runtime artifact (uploads, sessions, logs) is tracked.
7	git log -6	The last five commits use free-form messages — Everything I changed, Added  DFD Documentation (double space), Modified the DFDs, Modified DFD 2.0, Updated diagrams — contradicting the feat: / fix: / test(...)(M3b) convention stated in AGENTS.md.
8	.gitattributes:2-4	Marks *.png, *.pdf, and *.jpg as binary but omits *.jpeg, which the repo does track (ClassroomBG.jpeg). Mitigated by * text=auto on line 1.
9	storage/uploads/materials/26d5ad3743b130c1213a29d385553a9a.pdf	0 bytes — a failed upload left behind. Gitignored; harmless.
10	storage/uploads/logos/, storage/uploads/plans/	Both empty on disk and gitignored.
Category 10 — Documentation Consistency
#	Location	Finding
1	README.md:93-115	Documents four working test commands with expected check counts ("15 checks", "27 checks"). All four are broken because the suites were deleted in f6e410e.
2	README.md:119-121	The "Demo Login Accounts" section is an empty stub — no credentials, even though initDatabase.js seeds admin, teacher, and student accounts.
3	README.md:5,31,54 vs .env.example:17,20-28 vs src/config/env.js:30,33-40	Three-way AI configuration inconsistency: the README says "Ollama (Qwen 2.5 7B)" and never mentions 9Router; .env.example:17 sets OLLAMA_MODEL=gpt-oss:120b-cloud; the env.js:30 default is qwen2.5:7b; and AI_PRIMARY defaults to nine_router.
4	README.md:49 (env snippet)	Omits SESSION_SECRET and the entire NINE_ROUTER_* block, both required for a working boot.
5	all 6 docs + README.md + AGENTS.md	Every path:line and path:a-b reference resolves to an existing file, and every line range falls within the target file's length — including all of docs/edushare-dfd.md and docs/edushare-modelling-diagrams.md. No stale citations.
6	docs/edushare-modelling-diagrams.md:448-464	Honestly labels six drawn-but-not-route-backed functions (school-wide announcement post, SF9 view, chat with teacher, view classmates, leave class, student gradebook page). This is a documented feature backlog, not an error.
7	AGENTS.md (DB boot section)	States that initDatabase migrates "…section_transfer_requests, student_change_requests, notifications tables". Those three are plain CREATE TABLE IF NOT EXISTS statements in schema.sql; initDatabase.js contains zero CREATE TABLE statements and no matching ALTER. Minor inaccuracy.
8	AGENTS.md (Uploads section)	Calls public/uploads/ a "legacy leftover; don't use it" — accurate, but the folder is still live-served and still holds a real avatar (Cat 1 #5).
9	README.md	Never documents npm run dev or npm run init-db. AGENTS.md's claim that docs/ai-lesson-generation-backend.md §9 still describes the removed suites is accurate.
Recommended Actions (Priority Order)
 1. Fix the PPTX import — src/controllers/aiController.js:889,897, change './pptxService' to '../services/pptxService'. One-line fix that restores a shipped feature and clears 3 findings.
 2. Recover the test suites — git checkout origin/main -- tests/, then git branch -f main origin/main. Every route the suites reference still exists, so this should work as-is. Clears the 4 dead npm scripts and the README lie.
 3. Fix the SMTP variable names — rename .env.example:45-51 from EMAIL_* to the SMTP_* names env.js:56-61 actually reads, add MAIL_FROM, and document that OTP_DEV_LOG=true suppresses real delivery. Otherwise every OTP and password-reset email throws in any non-dev environment.
 4. Retire public/uploads/ — confirm no DB rows reference /uploads/..., delete the directory and the express.static exposure path, then correct the .gitignore:11-12 negation.
 5. De-duplicate the enrollment backfill — have initDatabase.js:134-172 call enrollmentService.backfillMissingEnrollments() and delete the inline copy.
 6. Stop logging email contents — gate the console.log calls in mailService.js:64-73 behind NODE_ENV !== 'production'.
 7. Delete the five orphans — src/views/images/ClassroomBG.jpeg, src/views/partials/footer.ejs, root edushare-schema.sql, root scripts/, and the attendance table in both schema files.
 8. Prune unused code and dependencies — remove the 6 dead exports, the exportGradebook stub, the over-exported doResetPassword, the unused ALLOWED_DOC_EXTS, and the unused nodemailer dependency (or use it to replace the hand-rolled SMTP client).
 9. Reconcile the documentation — settle the AI provider/model story, add SESSION_SECRET and the NINE_ROUTER_* block to the README env snippet, fill in the demo login section, correct importCuratedJson.js:2, and fix the two AGENTS.md inaccuracies.
10. Housekeeping — add the 5 missing variables to .env.example, add engines + .nvmrc, re-compress the 7 MB of images, move the 1.21 MB of archify artifacts out of docs/, add *.jpeg to .gitattributes, and switch to conventional commit messages.
No files were changed during this audit.