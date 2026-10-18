import { answerKeys, parseExamAnswers } from './exams.js';

export const PRACTICE_STORAGE_KEY = 'nwordbook:exam-practice:v1';
export const GRADE_LABELS = { correct: '○', partial: '△', incorrect: '×' };
export const GRADE_WEIGHTS = { correct: 1, partial: 0.5, incorrect: 0 };
export const MAX_PRACTICE_BACKUP_BYTES = 20 * 1024 * 1024;
const MAX_TIME = 365 * 24 * 60 * 60 * 1000;
export const practiceId = (paper, question) => `${paper.id}-${question.number}`;
export const fieldSnapshot = (field, answers) => JSON.stringify(answerKeys({ fields: [field] }).map(key => answers[key] || ''));
export function elapsedTime(timer, now = Date.now()) {
  return Math.min(MAX_TIME, (timer?.elapsedMs || 0) + (timer?.startedAt != null ? Math.max(0, now - timer.startedAt) : 0));
}
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function currentGrade(field, answers, marks) {
  const mark = marks[field.id];
  return mark && mark.snapshot === fieldSnapshot(field, answers) ? mark.value : null;
}
export function gradeSummary(question, answers, marks) {
  const fields = question.fields.filter(field => !field.invalid);
  const counts = { correct: 0, partial: 0, incorrect: 0 };
  for (const field of fields) { const grade = currentGrade(field, answers, marks); if (grade) counts[grade]++; }
  const graded = Object.values(counts).reduce((n, count) => n + count, 0);
  const points = counts.correct + counts.partial * 0.5;
  return { ...counts, graded, total: fields.length, pending: fields.length - graded, score: fields.length ? Math.round(points / fields.length * 1000) / 10 : null, excluded: question.fields.length - fields.length };
}

export function parsePracticeState(raw, catalog) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 10 * 1024 * 1024) throw new Error('採点・タイマーの保存形式を確認できません。');
  const data = JSON.parse(raw);
  if (data?.schemaVersion !== 1 || !data.marks || typeof data.marks !== 'object' || Array.isArray(data.marks) || !data.timers || typeof data.timers !== 'object' || Array.isArray(data.timers)) throw new Error('採点・タイマーの保存形式が不正です。');
  const fields = new Map(catalog.papers.flatMap(p => p.questions.flatMap(q => q.fields.map(f => [f.id, f]))));
  const ids = new Set(catalog.papers.flatMap(p => p.questions.map(q => practiceId(p, q))));
  const marks = {}, timers = {};
  for (const [id, mark] of Object.entries(data.marks)) {
    if (!fields.has(id) || fields.get(id).invalid || !Object.hasOwn(GRADE_WEIGHTS, mark?.value) || typeof mark.snapshot !== 'string' || mark.snapshot.length > 300000) throw new Error('対応していない採点データがあります。');
    const snapshot = JSON.parse(mark.snapshot);
    if (!Array.isArray(snapshot) || snapshot.length !== answerKeys({ fields: [fields.get(id)] }).length || snapshot.some(s => typeof s !== 'string' || s.length > 10000)) throw new Error('採点時の回答データが不正です。');
    marks[id] = { value: mark.value, snapshot: mark.snapshot };
  }
  for (const [id, timer] of Object.entries(data.timers)) {
    if (!ids.has(id) || !Number.isSafeInteger(timer?.elapsedMs) || timer.elapsedMs < 0 || timer.elapsedMs > MAX_TIME || (timer.startedAt !== null && (!Number.isSafeInteger(timer.startedAt) || timer.startedAt < 0))) throw new Error('タイマーの保存データが不正です。');
    timers[id] = { elapsedMs: timer.elapsedMs, startedAt: timer.startedAt };
  }
  if (Object.values(timers).filter(t => t.startedAt !== null).length > 1) throw new Error('複数のタイマーが同時に動作しています。');
  return { schemaVersion: 1, marks, timers };
}
export function parseExamBackup(raw, catalog) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_PRACTICE_BACKUP_BYTES) throw new Error('バックアップは20MB以下にしてください。');
  const data = JSON.parse(raw);
  const answers = parseExamAnswers(JSON.stringify({ schemaVersion: data?.schemaVersion, answers: data?.answers }), catalog);
  if (data.practice !== undefined) answers.practice = parsePracticeState(JSON.stringify(data.practice), catalog);
  return answers;
}
export function exportExamBackup(answers, practice, now = Date.now()) {
  return JSON.stringify({ ...JSON.parse(answers.export()), practice: practice.backup(now) }, null, 2);
}

export function createPracticeStore(catalog, getStorage = () => globalThis.localStorage) {
  let state = { schemaVersion: 1, marks: {}, timers: {} }, persistent = true, notice = '', storage;
  try { storage = getStorage(); const raw = storage.getItem(PRACTICE_STORAGE_KEY); if (raw !== null) state = parsePracticeState(raw, catalog); }
  catch { persistent = false; notice = '採点・タイマーを読み込めないため一時保存に切り替えました。元の保存内容は上書きしません。閉じる前に回答バックアップを保存してください。'; }
  const fields = new Map(catalog.papers.flatMap(p => p.questions.flatMap(q => q.fields.map(f => [f.id, f]))));
  const ids = new Set(catalog.papers.flatMap(p => p.questions.map(q => practiceId(p, q))));
  function persist() {
    if (persistent) try { storage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(state)); }
    catch { persistent = false; notice = '採点・タイマーを端末に保存できません。閉じる前に回答バックアップを保存してください。'; }
  }
  function pause(id, now = Date.now()) {
    const timer = state.timers[id];
    if (!timer || timer.startedAt === null) return;
    state = { ...state, timers: { ...state.timers, [id]: { elapsedMs: elapsedTime(timer, now), startedAt: null } } }; persist();
  }
  return {
    get state() { return state; }, get notice() { return notice; }, get persistent() { return persistent; },
    mark(id, value, answers) {
      const field = fields.get(id); if (!field || field.invalid || (value !== null && !Object.hasOwn(GRADE_WEIGHTS, value))) throw new Error('この欄は採点できません。');
      const marks = { ...state.marks };
      if (value === null) delete marks[id]; else marks[id] = { value, snapshot: fieldSnapshot(field, answers) };
      state = { ...state, marks }; persist();
    },
    pause,
    start(id, now = Date.now()) {
      if (!ids.has(id)) throw new Error('タイマーの大問IDが不正です。');
      for (const other of Object.keys(state.timers)) if (other !== id) pause(other, now);
      if (state.timers[id]?.startedAt != null) return;
      state = { ...state, timers: { ...state.timers, [id]: { elapsedMs: state.timers[id]?.elapsedMs || 0, startedAt: now } } }; persist();
    },
    reset(id) {
      if (!ids.has(id)) throw new Error('タイマーの大問IDが不正です。');
      state = { ...state, timers: { ...state.timers, [id]: { elapsedMs: 0, startedAt: null } } }; persist();
    },
    pauseOthers(id, now = Date.now()) { for (const other of Object.keys(state.timers)) if (other !== id) pause(other, now); },
    backup(now = Date.now()) { return { ...state, timers: Object.fromEntries(Object.entries(state.timers).map(([id, timer]) => [id, { elapsedMs: elapsedTime(timer, now), startedAt: null }])) }; },
    merge(incoming, now = Date.now()) {
      const next = parsePracticeState(JSON.stringify(incoming), catalog);
      for (const id of Object.keys(state.timers)) pause(id, now);
      state = { schemaVersion: 1, marks: { ...state.marks, ...next.marks }, timers: { ...state.timers, ...Object.fromEntries(Object.entries(next.timers).map(([id, timer]) => [id, { elapsedMs: elapsedTime(timer, now), startedAt: null }])) } }; persist();
    },
  };
}
