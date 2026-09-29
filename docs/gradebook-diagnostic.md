Gradebook
Issue 1 — Autosave never refreshes the computed grade columns
Category: Stale display
Evidence: public/js/gradebook.js:38-59, src/views/teacher/gradebook.ejs:119-137, src/routes/apiRoutes.js:14-66
Symptom: After a successful autosave the client updates only the individual score input. The category totals, initial grade, transmuted grade, and remarks rendered server-side are never recomputed on the page.
Impact: A teacher who corrects a grade sees the old computed figures until a full page reload, and can misread a student's standing.
Suggested fix: Have /api/gradebook/entry return the recomputed per-student summary from gradebookService, and update those cells on save success.
Issue 2 — Clearing a score cell sends no request
Category: Broken data flow
Evidence: public/js/gradebook.js:29-41, src/config/schema.sql:325
Symptom: The empty-cell branch returns before issuing a request, so the previous score stays in the database. gradebook_entries.score is NOT NULL DEFAULT 0.00, so a clear cannot be persisted by simply omitting the value.
Impact: Teachers cannot remove a mistaken entry; the old score silently reappears on refresh.
Suggested fix: Send an explicit clear (e.g. score: 0 plus a cleared flag) and treat it as a real write, or drop the clear affordance and require re-entering a value.
Issue 3 — Manual saves set manual_override = 1 on auto-synced columns
Category: Inconsistent state
Evidence: src/routes/apiRoutes.js:57-66, src/config/schema.sql:310,326, src/services/gradebookService.js:198-200
Symptom: The save endpoint sets manual_override = 1 for every column, including source_type of quiz or activity.
Impact: Once a teacher hand-corrects a quiz-linked column, the automatic sync is suppressed for that cell, so the gradebook and the quiz result disagree indefinitely.
Suggested fix: Only set manual_override when source_type = 'manual', and clear it when a teacher accepts the synced value.
Issue 4 — New classes get categories but no gradebook columns
Category: Broken data flow
Evidence: src/controllers/teacherController.js:159, src/config/initDatabase.js:475,505, src/controllers/aiController.js:849, src/controllers/teacherController.js:375
Symptom: Class creation inserts the DepEd categories only. Every INSERT INTO gradebook_columns in the codebase lives in the AI quiz/lesson flows or in the demo seeder — none in the class-creation path.
Impact: A freshly created class renders an empty gradebook with no manual entry columns until an AI-generated quiz happens to create one.
Suggested fix: Seed default manual columns (e.g. per written-works/performance-task component) when the class is created, or add an explicit "add column" action for teachers.
AI Lesson Generator
Issue 1 — Attaching a plan file silently discards all array preferences
Category: Broken data flow
Evidence: public/js/lesson-wizard.js:557 vs src/controllers/aiController.js:339-343
Symptom: On the multipart path every array preference is appended as JSON.stringify(v), so the server receives "[\"Cooperative Learning\"]". The controller gates on Array.isArray(req.body.approach), which is false for a string, and falls back to []. The JSON path (lesson-wizard.js:578) sends real arrays and works.
Impact: Approach, integration, resources, and assessment choices are silently ignored whenever a teacher uploads a file instead of pasting — with no warning.
Suggested fix: Either JSON.parse string values before the Array.isArray check, or parse prefs on the client into a delimited scalar field.
Issue 2 — Saving to the library bypasses the allow_ai_lesson kill switch
Category: Missing validation
Evidence: src/controllers/aiController.js:197,277,884 vs src/controllers/aiController.js:491-582, src/middleware/branding.js:32-36
Symptom: parsePlan, generateLesson, and exportLessonPptx all return 403 when the admin disables the feature. saveLessonToLibrary has no equivalent check.
Impact: A teacher with the page already open can still save and publish lesson content after an admin has turned the generator off, defeating the control.
Suggested fix: Add the same res.locals.school.flags.allowAiLesson guard at the top of saveLessonToLibrary.
Issue 3 — Grid cell edits are lost on draft restore
Category: Inconsistent state
Evidence: public/js/lesson-wizard.js:74,290,1016-1017
Symptom: saveLessonDraft persists the original gridModel; edited cell text lives only in the contenteditable DOM and is captured into gridTouched at submit time.
Impact: A teacher who edits plan cells, refreshes or returns later, and finds their corrections reverted with no warning.
Suggested fix: Fold the current DOM cell values back into the persisted gridModel inside saveLessonDraft.
Issue 4 — Long grid cells silently truncate on edit
Category: Broken data flow
Evidence: public/js/lesson-wizard.js:289-290
Symptom: Cells over 500 characters render as cell.slice(0, 500) + '…', and data-grid-orig is sliced to 500 as well. Editing such a cell submits the truncated text.
Impact: The tail of a long plan section is dropped from the prompt with no error, producing a lesson that silently omits plan content the teacher wrote.
Suggested fix: Render the full cell text in the DOM and truncate only via CSS, or expand the cell on focus.
Issue 5 — Grid rebuilds under 200 characters are silently discarded
Category: Missing error handling
Evidence: src/controllers/aiController.js:312-318
Symptom: If a teacher's cell edits shrink the rebuilt plan below 200 characters, the condition fails and generation silently proceeds with the unedited planRaw.
Impact: The generated deck does not match what the teacher sees in the grid, with no indication that the edits were rejected.
Suggested fix: Reject the request with a 422 explaining the minimum, mirroring the existing check at aiController.js:320-322.
Issue 6 — class_profile preference is a no-op expression
Category: Unused or dead code paths
Evidence: src/controllers/aiController.js:344
Symptom: String(req.body.class_profile || parsed.sessions && '' || '') evaluates to just class_profile, because a truthy parsed.sessions short-circuits && '' to ''.
Impact: Harmless today, but the expression implies a parsed.sessions fallback that never happens and will mislead the next reader.
Suggested fix: Reduce to String(req.body.class_profile || '').
AI Quiz Generator
Issue 1 — Quiz grounding reads bullets, but decks now store slide_text
Category: Broken data flow
Evidence: src/services/groundingService.js:273-274 vs src/services/groundingService.js:84-91, src/services/validationService.js:17-23, src/services/pptxService.js:29-30
Symptom: buildQuizPrompt receives the raw parsed deck (aiController.js:606-610, unnormalized) and builds the <lesson_deck> block solely from sl.bullets. The current lesson contract writes slide_text, which validation and PPTX export both treat as the projection. The offline fallback masks this because it populates both fields (src/services/aiService.js:433).
Impact: For every live-generated deck the model receives slide titles with an empty body (Slide 4 (example): Title — ) while the prompt instructs it to "align items with the generated deck slides," so deck alignment silently does nothing.
Suggested fix: Read sl.slide_text ?? sl.bullets (mirroring pptxService.js:29-30) when building the deck block.
Issue 2 — The plan is sent twice, duplicating it in the prompt
Category: Broken data flow
Evidence: public/js/quiz-maker-teacher.js:228,246-250, src/controllers/aiController.js:612-628
Symptom: The uploaded plan file is retained alongside the text auto-parsed out of it. The server then concatenates both (aiController.js:620) and parses the result again (626-629).
Impact: Roughly doubles the plan content in the prompt, wasting context and skewing the model toward the duplicated material.
Suggested fix: Clear the retained file once parsing succeeds, or send only one of the two representations.
Issue 3 — Client-supplied grounded bypasses the traceability gate
Category: Missing validation
Evidence: src/controllers/aiController.js:702-706
Symptom: The server recomputes citation coverage only when grounded === undefined. Because the client always sends the flag, an ungrounded quiz is accepted without the 422 confirmation prompt.
Impact: The plan-traceability control documented at aiController.js:699-701 is not enforced; any client can mark its own content as grounded.
Suggested fix: Drop the client-sent flag from the gate and always derive quizGrounded from the stored ai_content metadata, as the lesson path does at aiController.js:505-519.
Issue 4 — Duplicate class_ids cause a 500 on save
Category: Missing validation
Evidence: src/controllers/aiController.js:717-728,834-840, src/config/schema.sql:202
Symptom: class_ids is mapped and ownership-checked but never deduplicated, then inserted one row at a time into section_quizzes, which carries UNIQUE KEY unique_section_quiz (quiz_id, class_id).
Impact: A duplicated selection (or a double-clicked checkbox) passes the ownership check, then aborts the transaction with ER_DUP_ENTRY and returns a generic "AI service unavailable" 500.
Suggested fix: Deduplicate with [...new Set(...)] after parsing, and use INSERT IGNORE or ON DUPLICATE KEY UPDATE for the section links.
Issue 5 — Multiple-choice edits are not saved to the draft
Category: Inconsistent state
Evidence: public/js/quiz-maker-teacher.js:543-556
Symptom: The option-text listeners register saveQuizDraft() outside the callback instead of inside the change handler, and the correct-answer change handler does not save at all.
Impact: Option wording and answer-key changes are lost if the page is refreshed or the teacher navigates away before clicking save.
Suggested fix: Call saveQuizDraft() from inside each change handler, including the correct-answer handler.
Issue 6 — time_limit accepts negative values
Category: Missing validation
Evidence: src/controllers/aiController.js:764
Symptom: parseInt(time_limit, 10) || 15 rejects only 0 and non-numeric input; -30 passes through unchanged.
Impact: A negative time limit is stored and later breaks the student attempt timer.
Suggested fix: Validate the parsed value is a positive integer within a sane range before use.
Chatbot
Issue 1 — Every message runs the same history query twice
Category: Unused or dead code paths
Evidence: src/controllers/aiController.js:74-89
Symptom: The first query already uses (subject = ? OR subject = 'General'). For any non-General subject a second, semantically identical query runs and the first result is discarded at line 89.
Impact: One redundant database round trip per message, and the first result is dead work.
Suggested fix: Delete the mixed query and use recent unconditionally.
Issue 2 — Reloaded history silently truncates long answers
Category: Stale display
Evidence: src/controllers/aiController.js:145 vs src/controllers/aiController.js:116
Symptom: Responses are stored up to 20,000 characters, but the history endpoint selects LEFT(ai_response, 6000) with no truncation marker.
Impact: A student who refreshes or switches subject sees a long answer cut off mid-sentence, with no indication it is incomplete.
Suggested fix: Return the full text, or add an explicit truncated flag the client renders as a notice.
Issue 3 — Scoped clear does not match scoped load
Category: Inconsistent state
Evidence: src/controllers/aiController.js:138-141 vs src/controllers/aiController.js:181-182
Symptom: Loading with ?subject=Science returns Science and General rows, but clearing with the same parameter deletes only subject = 'Science'.
Impact: "Clear Science only" removes the visible rows client-side, yet the General exchanges shown alongside reappear on the next load or subject switch, making the clear look like it failed.
Suggested fix: Use the same predicate for both operations, or exclude General rows from subject-scoped views.
Issue 4 — Chat endpoints are not restricted to students
Category: Route mismatches
Evidence: src/routes/aiRoutes.js:8-13, src/routes/studentRoutes.js:23, src/controllers/aiController.js:38-45
Symptom: The /student/chatbot page is gated by requireRole('student'), but the four /api/ai/chat/* routes are behind isAuthenticated alone. Ownership is still per-session, so the practical impact is limited.
Impact: Teachers and admins can reach a student-only surface, and the endpoints inherit no student-specific policy (e.g. guardian/roster context) that the page route implies.
Suggested fix: Add requireRole('student') to the chat routes to match the page route.
Issue 5 — Dead branches in the chatbot client
Category: Unused or dead code paths
Evidence: public/js/chatbot.js:596, public/js/chatbot.js:384, src/views/student/chatbot.ejs:40-55
Symptom: The chip handler reads a data-subject attribute that none of the six suggestion chips define, so the per-subject branch is unreachable. chatInput.disabled = on && false always evaluates to false.
Impact: Dead code implies per-subject suggestion behavior that does not exist, and the input-disable guard is a no-op that only Enter-key handling actually enforces.
Suggested fix: Remove the unreachable branch and the no-op assignment, or implement data-subject on the chips.
Two notes on scope: the chatbot's allowStudentChat kill switch is correctly enforced server-side (aiController.js:38-45), and there is no allow_ai_quiz setting anywhere in system_settings (adminController.js:568 writes only allow_ai_lesson), so I did not report a quiz-side flag bypass. Nothing was modified and the app was not run.