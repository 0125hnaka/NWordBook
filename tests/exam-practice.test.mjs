import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExamStore, parseExamAnswers } from '../src/exams.js';
import { PRACTICE_STORAGE_KEY, createPracticeStore, currentGrade, gradeSummary, parsePracticeState, parseExamBackup, exportExamBackup, elapsedTime, formatDuration, practiceId } from '../src/exam-practice.js';
import { validateExplanations, explanationFor } from '../src/exam-explanations.js';
const catalog = JSON.parse(await readFile(new URL('../data/exams/catalog.json', import.meta.url)));
const data = JSON.parse(await readFile(new URL('../data/exams/explanations-2025.json', import.meta.url)));
const paper = catalog.papers.find(p => p.id === '2025-1'), question = paper.questions[0], field = question.fields[0];
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }; };

test('○△×を均等配点し、未採点と不備を区別する', () => {
  const storage = memory(), store = createPracticeStore(catalog, () => storage);
  const invalid = catalog.papers.flatMap(p => p.questions).flatMap(q => q.fields).find(f => f.invalid);
  const q = { fields: [...question.fields.slice(0, 4), invalid] }, answers = {};
  store.mark(q.fields[0].id, 'correct', answers); store.mark(q.fields[1].id, 'partial', answers); store.mark(q.fields[2].id, 'incorrect', answers);
  assert.deepEqual(gradeSummary(q, answers, store.state.marks), { correct: 1, partial: 1, incorrect: 1, graded: 3, total: 4, pending: 1, score: 37.5, excluded: 1 });
  assert.throws(() => store.mark(invalid.id, 'correct', answers));
  assert.equal(createPracticeStore(catalog, () => storage).state.marks[field.id].value, 'correct');
});
test('記述・複合欄を変更したら古い採点は得点へ含めず、再採点できる', () => {
  const store = createPracticeStore(catalog, () => memory());
  const field = catalog.papers.find(p => p.id === '2025-2').questions[1].fields.find(f => f.parts?.length);
  const answers = { [`${field.id}#1`]: '理由', [`${field.id}#2`]: '処理' };
  store.mark(field.id, 'correct', answers); assert.equal(currentGrade(field, answers, store.state.marks), 'correct');
  answers[`${field.id}#2`] = '修正'; assert.equal(currentGrade(field, answers, store.state.marks), null);
  store.mark(field.id, 'partial', answers); assert.equal(currentGrade(field, answers, store.state.marks), 'partial');
  store.mark(field.id, null, answers); assert.equal(currentGrade(field, answers, store.state.marks), null);
});
test('タイマーは実時間で計測し、中断・再読込・再開後も時間を保持する', () => {
  const storage = memory(), store = createPracticeStore(catalog, () => storage), id = practiceId(paper, question);
  store.start(id, 1000); assert.equal(elapsedTime(store.state.timers[id], 6500), 5500);
  store.pause(id, 6500); assert.equal(elapsedTime(store.state.timers[id], 99000), 5500);
  const restored = createPracticeStore(catalog, () => storage); restored.start(id, 100000); restored.pause(id, 105000);
  assert.equal(elapsedTime(restored.state.timers[id]), 10500); assert.equal(formatDuration(3661000), '01:01:01');
  restored.reset(id); assert.equal(elapsedTime(restored.state.timers[id]), 0);
});
test('大問切り替えは他の時計を止め、バックアップは停止時点の時間を移す', () => {
  const store = createPracticeStore(catalog, () => memory()), id = practiceId(paper, question), other = practiceId(paper, paper.questions[1]);
  store.start(id, 1000); store.start(other, 4000);
  assert.deepEqual(store.state.timers[id], { elapsedMs: 3000, startedAt: null });
  const backup = store.backup(10000); assert.deepEqual(backup.timers[other], { elapsedMs: 6000, startedAt: null });
  assert.equal(store.state.timers[other].startedAt, 4000);
  const restored = createPracticeStore(catalog, () => memory()); restored.merge(backup, 999999);
  assert.equal(elapsedTime(restored.state.timers[other]), 6000);
  store.pauseOthers(null, 12000); assert.equal(store.state.timers[other].startedAt, null);
});
test('回答バックアップの旧形式と採点・時間を含む拡張形式に互換性がある', () => {
  const answers = createExamStore(catalog, () => memory()), practice = createPracticeStore(catalog, () => memory());
  answers.set(field.id, '回答'); practice.mark(field.id, 'correct', answers.answers);
  assert.equal(parseExamAnswers(answers.export(), catalog).answers[field.id], '回答');
  const backup = JSON.stringify({ ...JSON.parse(answers.export()), practice: practice.backup() });
  assert.equal(parseExamAnswers(backup, catalog).answers[field.id], '回答');
  const parsed = parsePracticeState(JSON.stringify(JSON.parse(backup).practice), catalog);
  assert.equal(currentGrade(field, parseExamAnswers(backup, catalog).answers, parsed.marks), 'correct');
  assert.deepEqual(parseExamBackup(exportExamBackup(answers, practice), catalog).practice, parsed);
  assert.equal(parseExamBackup(answers.export(), catalog).practice, undefined);
  const invalid = JSON.parse(backup); invalid.practice.marks.nope = { value: 'correct', snapshot: '[]' };
  assert.throws(() => parseExamBackup(JSON.stringify(invalid), catalog));
});
test('破損・未知の採点や同時に動く時計を拒否し、元データを保護する', () => {
  const storage = memory(); storage.setItem(PRACTICE_STORAGE_KEY, '{broken');
  const store = createPracticeStore(catalog, () => storage); store.mark(field.id, 'correct', {});
  assert.equal(store.persistent, false); assert.equal(storage.getItem(PRACTICE_STORAGE_KEY), '{broken');
  for (const state of [{ schemaVersion: 1, marks: 3, timers: {} }, { schemaVersion: 1, marks: { nope: { value: 'correct', snapshot: '[]' } }, timers: {} }, { schemaVersion: 1, marks: {}, timers: { '2025-1-1': { elapsedMs: 0, startedAt: 1000 }, '2025-1-2': { elapsedMs: 0, startedAt: 1000 } } }]) assert.throws(() => parsePracticeState(JSON.stringify(state), catalog));
});
test('容量不足でも採点・時間を書き出せる', () => {
  const store = createPracticeStore(catalog, () => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
  store.mark(field.id, 'correct', {}); store.start(practiceId(paper, question), 0);
  assert.equal(store.persistent, false); assert.equal(store.backup(1000).timers['2025-1-1'].elapsedMs, 1000);
});
test('2025年度5大問・96項目の解説は回答IDと出典・本文ページを照合する', () => {
  const validated = validateExplanations(data, catalog);
  assert.equal(validated.questions.length, 5); assert.equal(validated.questions.reduce((n, q) => n + q.fields.length, 0), 96);
  assert.equal(explanationFor(data, paper, question).title, 'ルータの更改');
  assert.equal(explanationFor(data, catalog.papers.find(p => p.year === 2024), question), null);
  const missing = structuredClone(data); missing.questions[0].fields.pop(); assert.throws(() => validateExplanations(missing, catalog));
  const wrongPage = structuredClone(data); wrongPage.questions[0].fields[0].focus.pages = [999]; assert.throws(() => validateExplanations(wrongPage, catalog));
});
