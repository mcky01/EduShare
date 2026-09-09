# EduShare 2.0 — Next-Gen Learning Management System

> **Zeferino Arroyo High School (Iriga City, 1981)**  
> *"Basta Zeferinian, Magaling Yan!"*  
> **Tech Stack:** Node.js, Express, EJS Templating, Bootstrap 5 + Liquid Glass CSS Design System, MySQL, Ollama (Qwen 2.5 7B).

---

## 🌟 Overview

**EduShare 2.0** is an enterprise-grade Learning Management System (LMS) re-architected from the ground up for zero errors, production readiness, and optimal user experience. It replaces legacy client-rendered HTML templates with a unified **Server-Side Rendered (SSR) Node.js + Express + EJS** architecture.

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
- **AI Lesson Plan Generator**: 3-step wizard grounded in DepEd standards and Ollama Qwen 2.5 7B. Generates structured slide presentations with instant preview, slide editing, and classroom posting.
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
| **Local AI Engine** | Ollama (`qwen2.5:7b`) with smart educational fallback resilience |
| **Security** | Helmet HTTP headers, CORS, Express rate limiting, bcrypt hashing |

---

## ⚡ Quick Start & Deployment

### 1. Prerequisites
- **Node.js** v18+ or v20+ installed.
- **MySQL / MariaDB** (e.g., XAMPP MySQL running on port 3306).
- **Ollama** (optional, recommended for live AI streaming: `ollama run qwen2.5:7b`). If Ollama is offline, EduShare 2.0 seamlessly activates its built-in educational fallback engine with zero errors.

### 2. Installation
```bash
cd EduShare2.0
npm install
```

### 3. Environment Setup
Copy `.env.example` to `.env` (or customize database credentials):
```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=edushare_db_v2
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
```

### 4. Start the Application
```bash
npm start
```
*Note: The system automatically checks, creates the database `edushare_db_v2`, runs the normalized schema, and seeds default accounts and classes on boot!*

Open your browser to: **`http://localhost:3000`**

---

## 🔑 Demo Login Accounts

| Role | Identifier / Email | Password |
|---|---|---|
| **School Administrator** | `admin@edushare.com` | `Admin123!` |
| **Teacher** | `maria.reyes@zahs.edu.ph` | `Teacher123!` |
| **Student** | `109876543210` (or `jan.samaniego@student.edushare.local`) | `Student123!` |
| **Student (Female)** | `109876543211` (or `alexis.aquilino@student.edushare.local`) | `Student123!` |

---

## 🎨 Liquid Glass Design System Highlights
- **ZAHS Color Harmony**: Forest Emerald (`#06381e`), Jade (`#10b981`), Warm Gold (`#f59e0b`).
- **Frosted Surfaces**: `backdrop-filter: blur(20px) saturate(180%)`, soft 1px border specular reflections.
- **Zero Clutter**: Highly readable typography, responsive layouts from mobile phones to ultrawide displays.
