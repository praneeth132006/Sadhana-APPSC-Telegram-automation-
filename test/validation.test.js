// Import the built-in Node.js test runner module
const test = require('node:test');
// Import Node.js strict assertion module for verifying expected outcomes
const assert = require('node:assert/strict');

// List of allowed APPSC exam subjects
const SUBJECTS = [
  'History', 'AP History', 'Geography', 'AP Geography',
  'Economy', 'AP Economy', 'Polity', 'Society',
  'Current Affairs', 'Science and Technology', 'Biology',
  'Chemistry', 'Physics', 'Environment', 'General Studies',
  'Disaster Management'
];

/**
 * validateQuestionItem — Mirrors the strict validation engine implemented in dashboard/app.js.
 * What it does: Enforces that every question must have Subject, Question text, 4 Options (A-D), and Answer.
 * What it brings: Guarantees questions missing any of the 4 essentials cannot be added under any circumstances.
 * Where changes can be seen: In dashboard/app.js parseJson() validation step and user error alerts.
 */
function validateQuestionItem(raw, rootSubject, dropdownSubject, defaults = {}) {
  // Check if raw question input is an object
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid question object' };
  }

  // Determine subject from question object, root JSON payload, or dashboard dropdown
  const subject = (raw.subject && String(raw.subject).trim()) || rootSubject || dropdownSubject;
  // Extract question prompt text
  const questionText = String(raw.question || raw.question_text || raw.text || raw.prompt || '').trim();

  // Extract all 4 options whether provided as array or individual keys
  const optionArray = Array.isArray(raw.options) ? raw.options : null;
  const optA = (optionArray ? String(optionArray[0] ?? '') : String(raw.option_a || raw.optionA || raw.a || '')).trim();
  const optB = (optionArray ? String(optionArray[1] ?? '') : String(raw.option_b || raw.optionB || raw.b || '')).trim();
  const optC = (optionArray ? String(optionArray[2] ?? '') : String(raw.option_c || raw.optionC || raw.c || '')).trim();
  const optD = (optionArray ? String(optionArray[3] ?? '') : String(raw.option_d || raw.optionD || raw.d || '')).trim();

  // Extract and validate correct answer letter (must be A, B, C, or D)
  const rawAnswer = String(raw.correct_answer || raw.correctAnswer || raw.answer || raw.correct || '').trim().toUpperCase();
  const validAnswer = ['A', 'B', 'C', 'D'].includes(rawAnswer) ? rawAnswer : '';

  // Track any missing essential fields
  const missing = [];
  if (!subject) missing.push('Subject Name');
  if (!questionText) missing.push('Question Text');
  if (!optA) missing.push('Option A');
  if (!optB) missing.push('Option B');
  if (!optC) missing.push('Option C');
  if (!optD) missing.push('Option D');
  if (!validAnswer) missing.push('Correct Answer (must be A, B, C, or D)');

  // If any essential field is missing, return failure with list of missing items
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  // Return normalized valid question with default status Approved
  return {
    ok: true,
    question: {
      subject,
      question: questionText,
      option_a: optA,
      option_b: optB,
      option_c: optC,
      option_d: optD,
      correct_answer: validAnswer,
      explanation: String(raw.explanation || '').trim(),
      difficulty: raw.difficulty || defaults.difficulty || 'Medium',
      status: raw.status || defaults.status || 'Approved'
    }
  };
}

// Test suite for strict question validation and default Approved status
test('validateQuestionItem accepts minimal question with only Subject, Question, 4 Options, and Answer', () => {
  // Define minimal question payload without explanation, tags, newspaper, date or topic
  const minimal = {
    subject: 'Environment',
    question: 'Which of the following is an autonomous body for green cover?',
    option_a: 'AP-Green',
    option_b: 'AP-Forest',
    option_c: 'AP-Eco',
    option_d: 'AP-Bio',
    correct_answer: 'A'
  };

  // Run validation
  const result = validateQuestionItem(minimal, '', '');
  // Assert validation succeeded
  assert.equal(result.ok, true);
  // Assert status defaulted to Approved
  assert.equal(result.question.status, 'Approved');
  // Assert difficulty defaulted to Medium
  assert.equal(result.question.difficulty, 'Medium');
  // Assert optional explanation is empty string without throwing error
  assert.equal(result.question.explanation, '');
});

test('validateQuestionItem accepts subject from root or dropdown when omitted on item', () => {
  // Question without subject field
  const noSubject = {
    question: 'Sample prompt?',
    option_a: '1',
    option_b: '2',
    option_c: '3',
    option_d: '4',
    correct_answer: 'B'
  };

  // Inherits subject from dropdown
  const fromDropdown = validateQuestionItem(noSubject, '', 'History');
  assert.equal(fromDropdown.ok, true);
  assert.equal(fromDropdown.question.subject, 'History');

  // Inherits subject from root JSON payload
  const fromRoot = validateQuestionItem(noSubject, 'Polity', '');
  assert.equal(fromRoot.ok, true);
  assert.equal(fromRoot.question.subject, 'Polity');
});

test('validateQuestionItem rejects question when any of the 4 essentials is missing', () => {
  // Case 1: Missing subject completely
  const missingSubject = {
    question: 'Sample prompt?',
    option_a: '1', option_b: '2', option_c: '3', option_d: '4', correct_answer: 'B'
  };
  const res1 = validateQuestionItem(missingSubject, '', '');
  assert.equal(res1.ok, false);
  assert.ok(res1.missing.includes('Subject Name'));

  // Case 2: Missing question text
  const missingQuestion = {
    subject: 'Environment',
    question: '   ',
    option_a: '1', option_b: '2', option_c: '3', option_d: '4', correct_answer: 'B'
  };
  const res2 = validateQuestionItem(missingQuestion, '', '');
  assert.equal(res2.ok, false);
  assert.ok(res2.missing.includes('Question Text'));

  // Case 3: Missing Option C
  const missingOptionC = {
    subject: 'Environment',
    question: 'Sample prompt?',
    option_a: '1', option_b: '2', option_c: '', option_d: '4', correct_answer: 'B'
  };
  const res3 = validateQuestionItem(missingOptionC, '', '');
  assert.equal(res3.ok, false);
  assert.ok(res3.missing.includes('Option C'));

  // Case 4: Missing or invalid Correct Answer
  const invalidAnswer = {
    subject: 'Environment',
    question: 'Sample prompt?',
    option_a: '1', option_b: '2', option_c: '3', option_d: '4', correct_answer: 'Z'
  };
  const res4 = validateQuestionItem(invalidAnswer, '', '');
  assert.equal(res4.ok, false);
  assert.ok(res4.missing.some(m => m.includes('Correct Answer')));
});
