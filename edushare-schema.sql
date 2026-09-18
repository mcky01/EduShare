-- ========================================================
-- EduShare LMS - full database export (structure + default seeds)
-- Generated 2026-09-13 from the live working database definition
-- (src/config/schema.sql, verified against live MySQL: 33 tables + notifications = 34).
--
-- CONTENTS:
--   Part 1: schema (34 tables incl. notifications, InnoDB / utf8mb4_unicode_ci)
--   Part 2: default seeds - system settings, DepEd competencies,
--           demo accounts, sample class (ENG7RZ), quiz + activity
--
-- DEMO LOGINS (change or delete these after import):
--   admin@edushare.com / Admin123!  (admin)
--   maria.reyes@zahs.edu.ph / Teacher123!  (teacher)
--   jan.samaniego@student.edushare.local / Student123!  (student)
--   alexis.aquilino@student.edushare.local / Student123!  (student)
--
-- IMPORT (fresh database; safe to run on an empty DB):
--   Option A - phpMyAdmin: create DB -> Import tab -> choose this file -> Go
--   Option B - MySQL CLI:  mysql -u root -p < edushare-schema.sql
--   Option C - Workbench:  Server > Data Import > Import from Self-Contained File
--
-- IMPORTANT: the database name below must match DB_NAME in the other
--   laptop's .env file (default in this project: edushare_db_v2).
--   On the other laptop you can ALSO just run:  npm run init-db
--   which builds the same schema + seeds automatically on first boot
--   (server.js runs initDatabase() every start).
-- NOTE: import into an EMPTY database. Re-importing over existing data
--   will raise duplicate-key errors on the seed rows (schema part is safe).
-- ========================================================

SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS `edushare_db_v2` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `edushare_db_v2`;

-- ================= PART 1: SCHEMA =================

-- ========================================================
-- EduShare Unified Database Schema
-- Zeferino Arroyo High School (Iriga City, 1981)
-- ========================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'teacher', 'student') NOT NULL DEFAULT 'student',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `status` ENUM('pending','active','rejected') NOT NULL DEFAULT 'active',
  `force_password_change` TINYINT(1) NOT NULL DEFAULT 0,
  `avatar_url` VARCHAR(255) DEFAULT NULL,
  `last_login` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_users_role` (`role`),
  INDEX `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `teachers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL UNIQUE,
  `employee_id` VARCHAR(50) DEFAULT NULL UNIQUE,
  `department` VARCHAR(100) DEFAULT 'Junior High School',
  `specialization` VARCHAR(100) DEFAULT 'General Education',
  `grade_level` VARCHAR(20) DEFAULT NULL,
  `section` VARCHAR(50) DEFAULT NULL,
  `is_adviser` TINYINT(1) NOT NULL DEFAULT 0,
  `advisory_grade` VARCHAR(20) DEFAULT NULL,
  `advisory_section` VARCHAR(50) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `students` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL UNIQUE,
  `student_id` VARCHAR(50) NOT NULL UNIQUE, -- LRN or Student ID
  `grade_level` VARCHAR(20) NOT NULL DEFAULT 'Grade 7',
  `section` VARCHAR(50) NOT NULL DEFAULT 'Rizal',
  `gender` ENUM('Male', 'Female', 'Other') DEFAULT 'Male',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_students_lrn` (`student_id`),
  INDEX `idx_students_grade_section` (`grade_level`, `section`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `classes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` INT NOT NULL,
  `class_name` VARCHAR(120) NOT NULL,
  `subject` VARCHAR(100) NOT NULL,
  `grade_level` VARCHAR(20) NOT NULL,
  `section` VARCHAR(50) NOT NULL,
  `class_code` VARCHAR(20) NOT NULL UNIQUE,
  `room` VARCHAR(50) DEFAULT NULL,
  `schedule` VARCHAR(255) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`teacher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_classes_code` (`class_code`),
  INDEX `idx_classes_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `enrollments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `class_id` INT NOT NULL,
  `enrollment_date` DATE DEFAULT (CURRENT_DATE),
  `status` ENUM('active', 'dropped', 'completed') DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_student_class` (`student_id`, `class_id`),
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `library_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `file_path` VARCHAR(255) DEFAULT NULL,
  `file_type` VARCHAR(50) DEFAULT NULL,
  `file_size` VARCHAR(30) DEFAULT NULL,
  `subject` VARCHAR(100) DEFAULT NULL,
  `grade_level` VARCHAR(20) DEFAULT NULL,
  `source` VARCHAR(50) NOT NULL DEFAULT 'upload',
  `lesson_content` MEDIUMTEXT DEFAULT NULL,
  `in_library` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`teacher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `class_materials` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `library_item_id` INT NOT NULL,
  `class_id` INT NOT NULL,
  `posted_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_class_material` (`library_item_id`, `class_id`),
  FOREIGN KEY (`library_item_id`) REFERENCES `library_items` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `class_activities` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `instructions` TEXT DEFAULT NULL,
  `file_path` VARCHAR(255) DEFAULT NULL,
  `file_type` VARCHAR(100) DEFAULT NULL,
  `file_size` VARCHAR(30) DEFAULT NULL,
  `points` INT NOT NULL DEFAULT 100,
  `due_date` DATETIME DEFAULT NULL,
  `accept_late` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`teacher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `activity_posts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `activity_id` INT NOT NULL,
  `class_id` INT NOT NULL,
  `posted_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_activity_class` (`activity_id`, `class_id`),
  FOREIGN KEY (`activity_id`) REFERENCES `class_activities` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `activity_submissions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `activity_id` INT NOT NULL,
  `class_id` INT NOT NULL,
  `student_id` INT NOT NULL,
  `file_path` VARCHAR(255) DEFAULT NULL,
  `file_type` VARCHAR(100) DEFAULT NULL,
  `note` TEXT DEFAULT NULL,
  `score` DECIMAL(8,2) DEFAULT NULL,
  `feedback` TEXT DEFAULT NULL,
  `status` ENUM('submitted', 'graded') NOT NULL DEFAULT 'submitted',
  `submitted_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `graded_at` DATETIME DEFAULT NULL,
  UNIQUE KEY `unique_submission` (`activity_id`, `class_id`, `student_id`),
  FOREIGN KEY (`activity_id`) REFERENCES `class_activities` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quizzes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `subject` VARCHAR(100) DEFAULT NULL,
  `grade_level` VARCHAR(20) DEFAULT NULL,
  `total_questions` INT NOT NULL DEFAULT 10,
  `time_limit_minutes` INT NOT NULL DEFAULT 15,
  `passing_score` INT NOT NULL DEFAULT 60,
  `question_language` VARCHAR(20) DEFAULT 'english',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`teacher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quiz_questions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `quiz_id` INT NOT NULL,
  `question_text` TEXT NOT NULL,
  `question_type` ENUM('multiple_choice', 'true_false', 'identification') NOT NULL DEFAULT 'multiple_choice',
  `points` INT NOT NULL DEFAULT 1,
  `order_index` INT NOT NULL DEFAULT 1,
  `explanation` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quiz_options` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `question_id` INT NOT NULL,
  `option_text` VARCHAR(500) NOT NULL,
  `is_correct` TINYINT(1) NOT NULL DEFAULT 0,
  `order_index` INT NOT NULL DEFAULT 1,
  FOREIGN KEY (`question_id`) REFERENCES `quiz_questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `section_quizzes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `quiz_id` INT NOT NULL,
  `class_id` INT NOT NULL,
  `start_time` DATETIME DEFAULT NULL,
  `end_time` DATETIME DEFAULT NULL,
  `is_published` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_section_quiz` (`quiz_id`, `class_id`),
  FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quiz_attempts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `quiz_id` INT NOT NULL,
  `class_id` INT NOT NULL,
  `score` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `max_score` INT NOT NULL DEFAULT 100,
  `percentage` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `passed` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('in_progress', 'submitted', 'graded') NOT NULL DEFAULT 'submitted',
  `started_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_student_quiz` (`student_id`, `quiz_id`),
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quiz_attempt_answers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `attempt_id` INT NOT NULL,
  `question_id` INT NOT NULL,
  `selected_option_id` INT DEFAULT NULL,
  `answer_text` VARCHAR(500) DEFAULT NULL,
  `is_correct` TINYINT(1) NOT NULL DEFAULT 0,
  `points_awarded` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_attempt_question` (`attempt_id`, `question_id`),
  FOREIGN KEY (`attempt_id`) REFERENCES `quiz_attempts` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`question_id`) REFERENCES `quiz_questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `announcements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `teacher_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `category` VARCHAR(50) NOT NULL DEFAULT 'general',
  `is_pinned` TINYINT(1) NOT NULL DEFAULT 0,
  `attachment_url` VARCHAR(500) DEFAULT NULL,
  `attachment_title` VARCHAR(255) DEFAULT NULL,
  `is_published` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`teacher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `announcement_reads` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `announcement_id` INT NOT NULL,
  `student_id` INT NOT NULL,
  `is_acknowledged` TINYINT(1) NOT NULL DEFAULT 0,
  `read_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `acknowledged_at` DATETIME DEFAULT NULL,
  UNIQUE KEY `unique_student_announcement` (`announcement_id`, `student_id`),
  FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Student notifications: per-student alert rows fanned out from teacher actions
-- (announcement posted, activity/material/quiz published, submission graded).
-- Writers live in src/services/notificationService.js; readers at /api/notifications.
-- link_url is the deep link the bell dropdown / notifications page redirects to.
-- ref_type+ref_id (+class_id for class-scoped events) dedupe re-posts/retries.
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `class_id` INT DEFAULT NULL,
  `type` ENUM('announcement','activity','material','quiz','grade','enrollment','reminder','system') NOT NULL DEFAULT 'announcement',
  `title` VARCHAR(255) NOT NULL,
  `message` VARCHAR(500) DEFAULT NULL,
  `link_url` VARCHAR(500) DEFAULT NULL,
  `ref_type` VARCHAR(50) NOT NULL DEFAULT '',
  `ref_id` INT NOT NULL DEFAULT 0,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `read_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_student_ref` (`student_id`, `ref_type`, `ref_id`, `class_id`),
  INDEX `idx_notifications_student` (`student_id`, `is_read`, `created_at`),
  INDEX `idx_notifications_class` (`class_id`),
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gradebook_categories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `category_name` VARCHAR(100) NOT NULL,
  `category_code` VARCHAR(50) NOT NULL,
  `weight_percentage` DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  `sort_order` INT NOT NULL DEFAULT 1,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gradebook_columns` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `category_id` INT NOT NULL,
  `column_name` VARCHAR(120) NOT NULL,
  `max_score` INT NOT NULL DEFAULT 100,
  `source_type` ENUM('manual', 'quiz', 'activity') NOT NULL DEFAULT 'manual',
  `quiz_id` INT DEFAULT NULL,
  `activity_id` INT DEFAULT NULL,
  `exam_part` VARCHAR(20) DEFAULT NULL,
  `sub_weight` DECIMAL(5,2) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`category_id`) REFERENCES `gradebook_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gradebook_entries` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `column_id` INT NOT NULL,
  `student_id` INT NOT NULL,
  `score` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `manual_override` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_col_student` (`column_id`, `student_id`),
  FOREIGN KEY (`column_id`) REFERENCES `gradebook_columns` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attendance` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `student_id` INT NOT NULL,
  `attendance_date` DATE NOT NULL,
  `status` ENUM('present', 'absent', 'late', 'excused') NOT NULL DEFAULT 'present',
  `remarks` VARCHAR(255) DEFAULT NULL,
  `recorded_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_attendance_day` (`class_id`, `student_id`, `attendance_date`),
  FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `action` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `category` ENUM('account', 'security', 'admin', 'teacher', 'student', 'system') NOT NULL DEFAULT 'system',
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` TEXT DEFAULT NULL,
  `category` VARCHAR(50) NOT NULL DEFAULT 'general',
  `description` VARCHAR(255) DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_content` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `content_type` ENUM('lesson', 'quiz', 'chat') NOT NULL,
  `topic` VARCHAR(255) DEFAULT NULL,
  `content` MEDIUMTEXT NOT NULL,
  -- metadata JSON is additive across generations:
  --   legacy CG/BOW lessons: {grounded, retrieval_reason, citations:[S#...], term, competency_code}
  --   plan-input lessons:    {source:'teacher_plan', plan_format, focus_session, plan_source, plan_hash, coverage, citations:[P#...]}
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `subject` VARCHAR(100) DEFAULT 'General',
  `grade_level` VARCHAR(20) DEFAULT 'Grade 7',
  `user_message` TEXT NOT NULL,
  `ai_response` TEXT NOT NULL,
  `provider_used` VARCHAR(50) DEFAULT 'Ollama (qwen2.5:7b)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `curriculum_documents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `doc_type` ENUM('CG', 'BOW', 'LE', 'LM') NOT NULL DEFAULT 'CG',
  `subject` VARCHAR(100) NOT NULL,
  `grade_level` VARCHAR(20) NOT NULL,
  `quarter` ENUM('Q1', 'Q2', 'Q3', 'Q4') DEFAULT NULL,
  `term` ENUM('T1', 'T2', 'T3') DEFAULT NULL,
  `file_path` VARCHAR(255) DEFAULT NULL,
  `pages` INT DEFAULT 1,
  `status` ENUM('indexed', 'pending', 'error') DEFAULT 'indexed',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_curriculum_term` (`term`),
  INDEX `idx_curriculum_subject_grade` (`subject`, `grade_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `document_chunks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `document_id` INT NOT NULL,
  `chunk_index` INT NOT NULL DEFAULT 0,
  `content` MEDIUMTEXT NOT NULL,
  `content_hash` CHAR(64) NOT NULL,
  `competency_code` VARCHAR(50) DEFAULT NULL,
  `quarter` ENUM('Q1', 'Q2', 'Q3', 'Q4') DEFAULT NULL,
  `term` ENUM('T1', 'T2', 'T3') DEFAULT NULL,
  `page_ref` VARCHAR(50) DEFAULT NULL,
  `embedding` MEDIUMTEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_doc_chunk` (`document_id`, `chunk_index`),
  INDEX `idx_chunks_term` (`term`),
  INDEX `idx_chunks_competency` (`competency_code`),
  FULLTEXT KEY `ft_chunks_content` (`content`),
  FOREIGN KEY (`document_id`) REFERENCES `curriculum_documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `competencies` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL,
  `description` TEXT NOT NULL,
  `subject` VARCHAR(100) NOT NULL,
  `grade_level` VARCHAR(20) NOT NULL,
  `quarter` VARCHAR(10) DEFAULT 'Q1',
  `term` ENUM('T1', 'T2', 'T3') DEFAULT NULL,
  `source_version` VARCHAR(100) DEFAULT 'DepEd MATATAG 2024',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_comp_code` (`code`),
  INDEX `idx_competencies_term` (`term`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phase 7: MySQL session store (mirrors src/config/sessionStore.js CREATE_TABLE_SQL).
-- Runtime self-creates this via ensureTable(); kept here so schema-only restores stay complete.
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) NOT NULL PRIMARY KEY,
  `expires` BIGINT NOT NULL,
  `data` MEDIUMTEXT,
  INDEX `idx_sessions_expires` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Self-registration: account lifecycle status (existing rows stay active)
-- MySQL-safe idempotent guard (information_schema check; ALTER ... IF NOT EXISTS is MariaDB-only)

CREATE TABLE IF NOT EXISTS `otp_verifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(150) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('teacher_register','student_register','password_reset') NOT NULL,
  `attempts` TINYINT NOT NULL DEFAULT 0,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_otp_email_purpose` (`email`, `purpose`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Adviser student-lifecycle: section transfer requests (dual approval).
-- A teacher never moves a student unilaterally: the sending adviser files
-- the request, then BOTH the receiving adviser and an admin must approve
-- (either order). On final approval the student's grade_level/section is
-- updated and enrollments re-synced; grades/submissions are preserved.
-- One pending request per student at a time (unique key).
CREATE TABLE IF NOT EXISTS `section_transfer_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `from_grade` VARCHAR(20) NOT NULL,
  `from_section` VARCHAR(50) NOT NULL,
  `to_grade` VARCHAR(20) NOT NULL,
  `to_section` VARCHAR(50) NOT NULL,
  `requested_by` INT NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `receiver_decided_by` INT DEFAULT NULL,
  `receiver_decision` ENUM('approved','rejected') DEFAULT NULL,
  `receiver_decided_at` DATETIME DEFAULT NULL,
  `admin_decided_by` INT DEFAULT NULL,
  `admin_decision` ENUM('approved','rejected') DEFAULT NULL,
  `admin_decided_at` DATETIME DEFAULT NULL,
  `decision_reason` VARCHAR(500) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_pending_student` (`student_id`, `status`),
  INDEX `idx_transfer_status` (`status`),
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Adviser student-lifecycle: unified change requests (admin approval).
-- Covers edit (names/gender/email/LRN), drop, restore, and deactivate
-- ("delete" from the teacher's view). A teacher never applies these
-- directly: every request carries the teacher's note/reason, and an
-- admin approves (executes) or rejects (with their own decision note).
-- The note is the whole point â€” it tells the admin what to decide.
-- `payload` holds type-specific fields as JSON:
--   edit:    {first_name?, last_name?, gender?, email?, lrn?} (only changed keys)
--   drop:    {}           (enrollments â†’ dropped; account stays active)
--   restore: {}           (enrollments â†’ active + re-enroll)
--   deactivate: {}        (status â†’ rejected-equivalent inactive; records kept)
-- One pending request per student at a time (unique key).
CREATE TABLE IF NOT EXISTS `student_change_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `request_type` ENUM('edit','drop','restore','deactivate') NOT NULL,
  `payload` JSON DEFAULT NULL,
  `teacher_note` VARCHAR(500) NOT NULL,
  `requested_by` INT NOT NULL,
  `status` ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `decided_by` INT DEFAULT NULL,
  `decision_note` VARCHAR(500) DEFAULT NULL,
  `decided_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_pending_change` (`student_id`, `status`),
  INDEX `idx_change_status` (`status`),
  INDEX `idx_change_type` (`request_type`),
  FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================= PART 2: DEFAULT SEEDS =================
-- ========================================================
-- EduShare â€” default seeds (mirrors src/config/initDatabase.js)
-- Import into a FRESH/EMPTY database.
-- Demo logins (plaintext shown only for local demo use):
--   admin@edushare.com / Admin123!
--   maria.reyes@zahs.edu.ph / Teacher123!
--   jan.samaniego@student.edushare.local / Student123!
--   alexis.aquilino@student.edushare.local / Student123!
-- Sample class code: ENG7RZ
-- ========================================================

-- ---------- System settings ----------
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `description`) VALUES
('school_name', 'Zeferino Arroyo High School', 'general', 'Official School Name'),
('school_abbr', 'ZAHS', 'general', 'School Abbreviation'),
('school_motto', 'Basta Zeferinian, Magaling Yan!', 'general', 'School Motto / Tagline'),
('school_year', '2026-2027', 'academic', 'Current School Year'),
('current_term', 'Term 1', 'academic', 'Current Active Grading Term'),
('school_logo', '/images/zahs-logo.png', 'branding', 'Header and Login School Crest'),
('session_timeout', '120', 'security', 'Session timeout in minutes'),
('allow_student_chat', '1', 'ai', 'Enable AI Study Chatbot for Students'),
('allow_ai_lesson', '1', 'ai', 'Enable AI Lesson Plan Generator for Teachers');

-- ---------- DepEd competencies ----------
INSERT INTO `competencies` (`code`, `description`, `subject`, `grade_level`, `quarter`, `term`, `source_version`) VALUES
('EN7LIT-I-1', 'Analyze literary texts as expressions of individual or communal values within structural contexts.', 'English', 'Grade 7', 'Q1', 'T1', 'DepEd MATATAG 2024'),
('EN7VR-I-2', 'Determine the meaning of words using context clues, affixes, and word analysis.', 'English', 'Grade 7', 'Q1', 'T1', 'DepEd MATATAG 2024'),
('EN7WC-I-3', 'Compose coherent paragraphs demonstrating informative and persuasive structures.', 'English', 'Grade 7', 'Q1', 'T1', 'DepEd MATATAG 2024'),
('EN7SS-I-4', 'Extract and synthesize information from varied print and digital resources.', 'English', 'Grade 7', 'Q2', 'T1', 'DepEd MATATAG 2024'),
('EN7OL-I-5', 'Deliver oral presentations observing effective verbal and non-verbal cues.', 'English', 'Grade 7', 'Q2', 'T1', 'DepEd MATATAG 2024');

-- ---------- Demo accounts ----------
INSERT INTO `users` (`first_name`, `last_name`, `email`, `password_hash`, `role`, `is_active`, `status`, `force_password_change`) VALUES
('Admin', 'Officer', 'admin@edushare.com', '$2b$10$oDqIhYAuLVYb5r9InyIxFuDnP2Br8Kc32QCprzBWc3WRN01BLfLLi', 'admin', 1, 'active', 0);
SET @admin_id = LAST_INSERT_ID();

INSERT INTO `users` (`first_name`, `last_name`, `email`, `password_hash`, `role`, `is_active`, `status`, `force_password_change`) VALUES
('Maria', 'Reyes', 'maria.reyes@zahs.edu.ph', '$2b$10$eKeDHw0fOIWmuqwUj972/uBZNLvXWGP2S39g0oozpM9eDrYMxYuX2', 'teacher', 1, 'active', 0);
SET @teacher_id = LAST_INSERT_ID();

INSERT INTO `teachers` (`user_id`, `employee_id`, `department`, `specialization`, `is_adviser`, `advisory_grade`, `advisory_section`) VALUES
(@teacher_id, 'EMP-2024-001', 'Junior High School', 'English & Literature', 1, 'Grade 7', 'Rizal');

INSERT INTO `users` (`first_name`, `last_name`, `email`, `password_hash`, `role`, `is_active`, `status`, `force_password_change`) VALUES
('Jan', 'Samaniego', 'jan.samaniego@student.edushare.local', '$2b$10$omnZl0G8P5DGWJVGXfgtC.ZfxP9JTFUckqME7MJ2Yde1/lltpaLQy', 'student', 1, 'active', 0);
SET @stu_user1 = LAST_INSERT_ID();
INSERT INTO `students` (`user_id`, `student_id`, `grade_level`, `section`, `gender`) VALUES
(@stu_user1, '109876543210', 'Grade 7', 'Rizal', 'Male');
SET @sp1 = LAST_INSERT_ID();

INSERT INTO `users` (`first_name`, `last_name`, `email`, `password_hash`, `role`, `is_active`, `status`, `force_password_change`) VALUES
('Alexis', 'Aquilino', 'alexis.aquilino@student.edushare.local', '$2b$10$omnZl0G8P5DGWJVGXfgtC.ZfxP9JTFUckqME7MJ2Yde1/lltpaLQy', 'student', 1, 'active', 0);
SET @stu_user2 = LAST_INSERT_ID();
INSERT INTO `students` (`user_id`, `student_id`, `grade_level`, `section`, `gender`) VALUES
(@stu_user2, '109876543211', 'Grade 7', 'Rizal', 'Female');
SET @sp2 = LAST_INSERT_ID();

-- ---------- Sample class + enrollments ----------
INSERT INTO `classes` (`teacher_id`, `class_name`, `subject`, `grade_level`, `section`, `class_code`, `room`, `schedule`) VALUES
(@teacher_id, 'English 7 - Section Rizal', 'English', 'Grade 7', 'Rizal', 'ENG7RZ', 'Room 204', 'Mon/Wed/Fri 8:00 AM - 9:00 AM');
SET @class_id = LAST_INSERT_ID();

INSERT IGNORE INTO `enrollments` (`student_id`, `class_id`, `status`) VALUES
(@sp1, @class_id, 'active'),
(@sp2, @class_id, 'active');

INSERT INTO `gradebook_categories` (`class_id`, `category_name`, `category_code`, `weight_percentage`, `sort_order`) VALUES
(@class_id, 'Written Works', 'written_works', 20.00, 1),
(@class_id, 'Performance Tasks', 'performance_tasks', 50.00, 2),
(@class_id, 'Quarterly Exam', 'quarterly_exam', 30.00, 3);

-- ---------- Sample announcement ----------
INSERT INTO `announcements` (`class_id`, `teacher_id`, `title`, `message`, `category`, `is_pinned`) VALUES
(@class_id, @teacher_id, 'Welcome to English 7 (SY 2026-2027)', 'Mabuhay Zeferinians! Welcome to our English 7 class. Please review our course syllabus and prepare for our upcoming literature journey. Basta Zeferinian, Magaling Yan!', 'academic', 1);

-- ---------- Sample quiz (3 questions) ----------
INSERT INTO `quizzes` (`teacher_id`, `title`, `description`, `subject`, `grade_level`, `total_questions`, `time_limit_minutes`, `passing_score`) VALUES
(@teacher_id, 'Quiz 1: Elements of Short Stories & Poetry', 'Assess understanding of characterization, plot elements, and figurative language.', 'English', 'Grade 7', 3, 10, 60);
SET @quiz_id = LAST_INSERT_ID();

INSERT INTO `quiz_questions` (`quiz_id`, `question_text`, `question_type`, `points`, `order_index`, `explanation`) VALUES
(@quiz_id, 'What element of a short story refers to the series of events and actions that relate to the central conflict?', 'multiple_choice', 1, 1, 'Plot represents the sequence of events centered around the conflict.');
SET @q1 = LAST_INSERT_ID();
INSERT INTO `quiz_options` (`question_id`, `option_text`, `is_correct`, `order_index`) VALUES
(@q1, 'Theme', 0, 1),
(@q1, 'Plot', 1, 2),
(@q1, 'Setting', 0, 3),
(@q1, 'Protagonist', 0, 4);

INSERT INTO `quiz_questions` (`quiz_id`, `question_text`, `question_type`, `points`, `order_index`, `explanation`) VALUES
(@quiz_id, 'A simile directly compares two unlike things using words such as "like" or "as".', 'true_false', 1, 2, 'Similes explicitly use "like" or "as" in comparisons.');
SET @q2 = LAST_INSERT_ID();
INSERT INTO `quiz_options` (`question_id`, `option_text`, `is_correct`, `order_index`) VALUES
(@q2, 'True', 1, 1),
(@q2, 'False', 0, 2);

INSERT INTO `quiz_questions` (`quiz_id`, `question_text`, `question_type`, `points`, `order_index`, `explanation`) VALUES
(@quiz_id, 'What figure of speech gives human attributes to non-human objects or abstract ideas?', 'identification', 1, 3, 'Personification attributes human qualities to non-human elements.');
SET @q3 = LAST_INSERT_ID();
INSERT INTO `quiz_options` (`question_id`, `option_text`, `is_correct`, `order_index`) VALUES
(@q3, 'personification', 1, 1);

INSERT INTO `section_quizzes` (`quiz_id`, `class_id`, `is_published`) VALUES (@quiz_id, @class_id, 1);

SELECT `id` INTO @ww_cat FROM `gradebook_categories` WHERE `class_id` = @class_id AND `category_code` = 'written_works' LIMIT 1;
INSERT INTO `gradebook_columns` (`class_id`, `category_id`, `column_name`, `max_score`, `source_type`, `quiz_id`, `sort_order`) VALUES
(@class_id, @ww_cat, 'Quiz 1: Elements of Short Stories', 3, 'quiz', @quiz_id, 1);

-- ---------- Sample activity ----------
INSERT INTO `class_activities` (`teacher_id`, `title`, `instructions`, `points`, `due_date`) VALUES
(@teacher_id, 'Activity 1: My Personal Value Narrative Essay', 'Write a 3-paragraph reflective essay about an experience that tested your honesty or resilience. Highlight how your family and community shaped your decision.', 100, DATE_ADD(CURRENT_DATE, INTERVAL 7 DAY));
SET @act_id = LAST_INSERT_ID();
INSERT INTO `activity_posts` (`activity_id`, `class_id`) VALUES (@act_id, @class_id);

SELECT `id` INTO @pt_cat FROM `gradebook_categories` WHERE `class_id` = @class_id AND `category_code` = 'performance_tasks' LIMIT 1;
INSERT INTO `gradebook_columns` (`class_id`, `category_id`, `column_name`, `max_score`, `source_type`, `activity_id`, `sort_order`) VALUES
(@class_id, @pt_cat, 'Activity 1: Value Narrative', 100, 'activity', @act_id, 1);
