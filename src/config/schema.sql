-- ========================================================
-- EduShare 2.0 Unified Database Schema
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

-- Self-registration: account lifecycle status (existing rows stay active)
-- MySQL-safe idempotent guard (information_schema check; ALTER ... IF NOT EXISTS is MariaDB-only)

CREATE TABLE IF NOT EXISTS `otp_verifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(150) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('teacher_register','student_register') NOT NULL,
  `attempts` TINYINT NOT NULL DEFAULT 0,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_otp_email_purpose` (`email`, `purpose`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
