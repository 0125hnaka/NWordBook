import { answerKeys, parseExamAnswers } from './exams.js';
import { createExamEntries } from './exam-storage.js';

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
  const fields = new Map(catalog.papers.flatMap(p => p.questions.flatMap(q => q.fields.map(f => [f.id, f]))));
  const ids = new Set(catalog.papers.flatMap(p => p.questions.map(q => practiceId(p, q))));
  const valid = new Set(['owner', ...[...fields.keys()].map(id => `mark/${id}`), ...[...ids].map(id => `timer/${id}`)]);
  const session = globalThis.crypto.randomUUID();
  let running = null;
  const unpack = values => ({ schemaVersion: 1,
    marks: Object.fromEntries(Object.entries(values).filter(([id]) => id.startsWith('mark/')).map(([id, value]) => [id.slice(5), value])),
    timers: Object.fromEntries(Object.entries(values).filter(([id]) => id.startsWith('timer/')).map(([id, value]) => [id.slice(6), value])),
  });
  const entries = createExamEntries({ key: PRACTICE_STORAGE_KEY, valid, getStorage,
    decodeLegacy(raw) {
      const legacy = parsePracticeState(raw, catalog);
      return Object.fromEntries([
        ...Object.entries(legacy.marks).map(([id, mark]) => [`mark/${id}`, mark]),
        // Legacy running clocks have no reliable crash checkpoint. Keep their
        // accumulated duration, never add time since the old page disappeared.
        ...Object.entries(legacy.timers).map(([id, t]) => [`timer/${id}`, { elapsedMs: t.elapsedMs, startedAt: null }]),
      ]);
    },
    validate(values) {
      const state = unpack(values);
      parsePracticeState(JSON.stringify(state), catalog);
      if (Object.values(state.timers).some(t => t.startedAt !== null)) throw new Error('Saved clocks must be paused');
      if (values.owner && (typeof values.owner.id !== 'string' || !values.owner.id || !ids.has(values.owner.timerId))) throw new Error('Invalid clock owner');
    },
  });
  function state() {
    const saved = unpack(entries.entries);
    return running ? { ...saved, timers: { ...saved.timers, [running.id]: { elapsedMs: running.elapsedMs, startedAt: running.startedAt } } } : saved;
  }
  function refresh() {
    entries.refresh();
    // The last tab to start a clock owns it. Losing ownership stops this tab
    // at the saved checkpoint, without writing over the new owner's clock.
    const owner = entries.entries.owner;
    if (entries.persistent && running && (owner?.id !== session || owner.timerId !== running.id)) running = null;
    return state();
  }
  function pause(id, now = Date.now()) {
    refresh();
    if (running?.id !== id) return;
    const timer = { elapsedMs: elapsedTime(running, now), startedAt: null };
    running = null;
    entries.write({ [`timer/${id}`]: timer });
  }
  function pauseOthers(id, now = Date.now()) { if (running && running.id !== id) pause(running.id, now); }
  return {
    get state() { return state(); }, get notice() { return entries.notice; }, get persistent() { return entries.persistent; },
    refresh,
    mark(id, value, answers) {
      const field = fields.get(id);
      if (!field || field.invalid || (value !== null && !Object.hasOwn(GRADE_WEIGHTS, value))) throw new Error('この欄は採点できません。');
      entries.write({ [`mark/${id}`]: value === null ? null : { value, snapshot: fieldSnapshot(field, answers) } });
    },
    pause, pauseOthers,
    start(id, now = Date.now()) {
      if (!ids.has(id)) throw new Error('タイマーの大問IDが不正です。');
      refresh(); pauseOthers(id, now);
      if (running?.id === id) return;
      const elapsedMs = state().timers[id]?.elapsedMs || 0;
      entries.write({ owner: { id: session, timerId: id }, [`timer/${id}`]: { elapsedMs, startedAt: null } });
      running = { id, elapsedMs, startedAt: now };
    },
    checkpoint(now = Date.now()) {
      refresh();
      if (running) entries.write({ [`timer/${running.id}`]: { elapsedMs: elapsedTime(running, now), startedAt: null } });
    },
    reset(id) {
      if (!ids.has(id)) throw new Error('タイマーの大問IDが不正です。');
      refresh();
      if (running?.id === id) running = null;
      entries.write({ [`timer/${id}`]: { elapsedMs: 0, startedAt: null }, ...(entries.entries.owner?.timerId === id ? { owner: null } : {}) });
    },
    backup(now = Date.now()) {
      const current = refresh();
      return { ...current, timers: Object.fromEntries(Object.entries(current.timers).map(([id, timer]) => [id, { elapsedMs: elapsedTime(timer, now), startedAt: null }])) };
    },
    merge(incoming, now = Date.now()) {
      const next = parsePracticeState(JSON.stringify(incoming), catalog);
      pauseOthers(null, now); refresh();
      entries.write(Object.fromEntries([
        ...Object.entries(next.marks).map(([id, value]) => [`mark/${id}`, value]),
        ...Object.entries(next.timers).map(([id, timer]) => [`timer/${id}`, { elapsedMs: timer.elapsedMs, startedAt: null }]),
        ...(Object.hasOwn(next.timers, entries.entries.owner?.timerId) ? [['owner', null]] : []),
      ]));
    },
  };
}
