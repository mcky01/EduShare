# EduShare — Next-Gen Learning Management System

> **Zeferino Arroyo High School (Iriga City, 1981)**  
> *"Basta Zeferinian, Magaling Yan!"*  
> **Tech Stack:** Node.js, Express, EJS Templating, Bootstrap 5 + Liquid Glass CSS Design System, MySQL, AI via 9Router → Ollama → offline fallback.

---

## 🌟 Overview

**EduShare** is an enterprise-grade Learning Management System (LMS) re-architected from the ground up for zero errors, production readiness, and optimal user experience. It replaces legacy client-rendered HTML templates with a unified **Server-Side Rendered (SSR) Node.js + Express + EJS** architecture.

The user interface features a modern **Liquid Glass** aesthetic—translucent frosted glass panels, glowing ambient gradients, and silky borders harmonized with the emerald green and gold insignia of Zeferino Arroyo High School.

---

## 🚀 Key Features by Role

### 👑 Administrator
- **Executive Dashboard**: Live faculty, student, class, and active account statistics.
- **User Lifecycle Management**: Register teachers (with advisory section designation) and students (with DepEd LRN). Toggle account active status or perform one-click temporary password resets.
- **Institutional Settings**: Manage school branding, motto, school year, active grading term, and upload official school crest logo.
- **Curriculum Standards & Knowledge Base**: Track DepEd MATATAG competencies for AI grounding.
- **Immutable Audit Trail**: Filterable activity log tracking logins, administrative actions, and security events.

### 👩‍🏫 Faculty Teacher
- **Classroom Hub**: Create class sections with auto-generated 6-character student join codes (e.g. `ENG7RZ`).
- **Class Learning Materials**: Upload worksheets, slide decks, and study packets to your personal library, and repost them across sections with one click.
- **Activities & Assignments**: Assign homework and performance tasks with point values, deadlines, and guidelines. Grade submissions online with feedback that automatically updates the electronic gradebook.
- **DepEd E-Class Record (Gradebook)**: Automated DepEd Order 8 s. 2015 & MATATAG transmutation matrix (Written Works 20%, Performance Tasks 50%, Quarterly Exam 30%). Real-time grade calculation, transmutation table, and instant CSV export.
- **AI Lesson Plan Generator**: 3-step wizard grounded in DepEd standards and the configured AI provider. Generates structured slide presentations with instant preview, slide editing, and classroom posting.
- **AI Quiz Maker**: Automated quiz authoring with multiple choice, true/false, and identification questions. Real-time auto-grading and automatic score sync to the class gradebook.
- **Advisory Section (SF1)**: View advisory learner roster with gender statistics and student credential management.

### 🎒 Student Learner
- **Learner Dashboard**: Overview of enrolled courses, upcoming deadlines, pending quizzes, and class announcements.
- **Join Class**: Instant enrollment via 6-character class code.
- **Distraction-Free Quiz Runner**: Fullscreen liquid glass quiz interface with countdown timer, question palette navigator, and flag-for-review tools.
- **Assessment Review**: Circular score ring, pass/fail status, and question-by-question explanations.
- **Activity Submission**: Upload homework files and attach personal notes to teachers.
- **AI Study Buddy & Tutor**: 24/7 Socratic AI study companion with real-time streaming tokens and subject specialization (English, Mathematics, Science, Araling Panlipunan).

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Runtime & Backend** | Node.js (v18+) & Express 4/5 |
| **Templating** | EJS (Embedded JavaScript) with `express-ejs-layouts` |
| **UI Framework** | Bootstrap 5 + Custom Liquid Glass Design System |
| **Database** | MySQL / MariaDB (using `mysql2/promise` connection pool) |
| **Authentication** | HttpOnly signed cookie sessions + role-based access control |
| **AI Engine** | 9Router (OpenAI-compatible, default) → Ollama (local) → offline static fallback. See [AI Provider Chain](#ai-provider-chain). |
| **RAG Embeddings** | Ollama `/api/embed` (`nomic-embed-text`) — local-only, never sent to 9Router. |
| **Security** | Helmet HTTP headers, CORS, Express rate limiting, bcrypt hashing |

---

## ⚡ Quick Start & Deployment

### 1. Prerequisites
- **Node.js** v18+ or v20+ installed.
- **MySQL / MariaDB** (e.g., XAMPP MySQL running on port 3306).
- **Ollama** (optional; required only if you want fully local generation): `ollama pull nomic-embed-text` for RAG embeddings, plus any chat model. If 9Router is unconfigured and Ollama is offline, EduShare activates its built-in educational fallback engine.

### 2. Installation
```bash
cd EduShare2.0
npm install
```

### 3. Environment Setup
Copy `.env.example` to `.env`. The full template documents every supported key;
the essentials are:

```env
PORT=3000
NODE_ENV=development

# Required in production — the app refuses to boot without it.
SESSION_SECRET=your_long_random_session_secret_key_here

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=edushare_db_v2

# AI primary provider: nine_router (default) or ollama.
AI_PRIMARY=nine_router
NINE_ROUTER_BASE_URL=http://localhost:20128/v1
NINE_ROUTER_API_KEY=paste_your_9router_key_here
NINE_ROUTER_MODEL=oc/nemotron-3-ultra-free
NINE_ROUTER_TIMEOUT_MS=90000

# Local Ollama — the fallback provider, and the only source of embeddings.
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
AI_TIMEOUT_MS=120000
```

<a id="ai-provider-chain"></a>
#### AI Provider Chain

Generation tries two providers and falls through to a built-in offline
generator. `AI_PRIMARY` in `.env` decides which is tried **first**; the other is
still used if the first one misses.

1. **9Router** (`AI_PRIMARY=nine_router`, the default) — OpenAI-compatible
   gateway on your machine. Requires **all three** of `NINE_ROUTER_BASE_URL`,
   `NINE_ROUTER_API_KEY`, and `NINE_ROUTER_MODEL`; if any is missing, or the
   call errors, or it returns empty content, the request falls through.
2. **Ollama** — local `OLLAMA_MODEL`, tried second under the default
   `AI_PRIMARY`. The code default is `qwen2.5:7b`; note `.env.example` ships
   `gpt-oss:120b-cloud`, which overrides it. Set `AI_PRIMARY=ollama` to try
   Ollama first instead.
3. **Offline fallback** — if both providers miss, `aiService` returns null and
   the caller uses a built-in static generator (`getFallbackLesson` /
   `getFallbackQuiz`). These make no network calls, and generated content is
   flagged `isFallback` in the UI and cannot be published without explicit
   teacher confirmation.

RAG embeddings for curriculum grounding and quiz generation are a **separate
path**: they always go to Ollama `/api/embed` using `OLLAMA_EMBED_MODEL`
(`nomic-embed-text`) and are never routed through 9Router. Generic or off-topic
AI output means the offline fallback fired — usually a wrong `OLLAMA_MODEL` or a
missing 9Router key.

### 4. Start the Application
```bash
npm start
```
*Note: The system automatically checks, creates the database `edushare_db_v2`, runs the normalized schema, and seeds default accounts and classes on boot!*

Open your browser to: **`http://localhost:3000`**

### 5. Testing

Prereqs for every suite: server running on `127.0.0.1:3000`, MySQL reachable,
dev database (`edushare_db_v2`). The registration suite additionally needs
`OTP_DEV_LOG=true` in the server environment.

```bash
npm test                    # smoke suite (15 checks): needs only the server running
npm run test:smoke          # same as npm test
npm run test:registration   # OTP registration suite: requires OTP_DEV_LOG=true
npm run test:integration    # end-to-end suite (27 checks): mutates the dev DB
```

- `test` stays smoke-only on purpose: registration and integration require
a live server + DB and mutate dev data (OTP rows, grades, library saves),
so chaining them under `npm test` would fail for anyone without that
environment.
- Registration suite deliberately trips the OTP rate limiter; a final 429
is expected behavior, not a failure.
- Integration suite writes grades, quiz attempts, and lesson saves — run
against a non-prod DB only.
- Restart the server between back-to-back suite runs to reset the login
limiter (20 POSTs / 15 min per IP).

---

## 🧰 Maintenance Scripts

Two one-off CLIs live in `src/scripts/`. They are not wired to `package.json`
scripts — run them directly with `node`. Both need `.env` populated and MySQL
reachable.

### `src/scripts/importCuratedJson.js` — bulk-load the RAG curriculum corpus

Imports a curated competency JSON file from `Resources/` into the RAG corpus:
one `curriculum_documents` row plus one tagged `document_chunks` row per entry,
with embeddings generated locally via Ollama.

```bash
node src/scripts/importCuratedJson.js "Resources/CG/CG English 7.json" CG "English 7 CG (curated)"
#                    <json-file>                                [doc_type]  [title]
```

`<json-file>` is required; `doc_type` defaults to `CG`, and `title` is optional.
The file must contain a non-empty JSON array. Available sources in this repo:

| Path | Type |
|---|---|
| `Resources/CG/CG English 7.json`, `Resources/CG/CG English 8.json` | CG |
| `Resources/BOW/BOW English 7.json` … `BOW English 10.json` | BOW |
| `Resources/LE/Grade 7/LE English 7 W1 T1.json` | LE |

### `src/scripts/reportBrokenQuizAnswers.js` — find/repair missing answer keys

Finds identification questions that have **no** `quiz_options` rows (an
unanswerable question), reporting quiz, teacher, and question text.

```bash
node src/scripts/reportBrokenQuizAnswers.js          # report only, no writes
node src/scripts/reportBrokenQuizAnswers.js --fix    # attempt recovery
```

With `--fix` it tries to recover the answer from the question's explanation
using the same helper the AI save path uses, inserting it as an
`is_correct = 1` option. Questions it cannot recover are listed for manual
fixing. **`--fix` writes to the database** — run it against a non-prod DB, and
take a backup first.

---

## 🔑 Demo Login Accounts

Seeded by `initDatabase` on first boot (existing databases are not re-seeded,
and passwords are never overwritten on re-run).

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@edushare.com` | `Admin123!` |
| Teacher | `maria.reyes@zahs.edu.ph` | `Teacher123!` |
| Student | `jan.samaniego@student.edushare.local` | `Student123!` |
| Student | `alexis.aquilino@student.edushare.local` | `Student123!` |

Both students are in **Grade 7 – Rizal**; the seeded class join code is `ENG7RZ`
(English 7 – Section Rizal).

> ⚠️ These are fixed, publicly documented credentials. Change them or remove the
> seed block before any deployment that is reachable by anyone but you, and set a
> real `SESSION_SECRET` at the same time.

---

## 🎨 Liquid Glass Design System Highlights
- **ZAHS Color Harmony**: Forest Emerald (`#06381e`), Jade (`#10b981`), Warm Gold (`#f59e0b`).
- **Frosted Surfaces**: `backdrop-filter: blur(20px) saturate(180%)`, soft 1px border specular reflections.
- **Zero Clutter**: Highly readable typography, responsive layouts from mobile phones to ultrawide displays.
