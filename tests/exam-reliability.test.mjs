import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExamStore, EXAM_STORAGE_KEY } from '../src/exams.js';
import { createPracticeStore, PRACTICE_STORAGE_KEY, elapsedTime, currentGrade, parseExamBackup, exportExamBackup } from '../src/exam-practice.js';
import { installExamSkipLink } from '../src/exam-navigation.js';

const catalog = JSON.parse(await readFile(new URL('../data/exams/catalog.json', import.meta.url)));
const fields = catalog.papers[0].questions[0].fields;
const [a, b] = fields;
const timerA = '2025-1-1', timerB = '2025-1-2';
function memory() {
  const map = new Map();
  return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null, setItem(k, v) { map.set(k, v); },
  };
}

test('開いたままの二つのタブで交互に回答・空欄化しても、別の回答を巻き戻さない', () => {
  const storage = memory(), tabA = createExamStore(catalog, () => storage), tabB = createExamStore(catalog, () => storage);
  tabA.set(a.id, 'Aの回答'); tabB.set(b.id, 'Bの回答'); tabA.set(a.id, 'Aを編集');
  tabB.refresh(); assert.deepEqual(tabB.answers, { [a.id]: 'Aを編集', [b.id]: 'Bの回答' });
  tabB.set(a.id, ''); tabA.set(b.id, 'Bを編集');
  assert.deepEqual(createExamStore(catalog, () => storage).answers, { [a.id]: '', [b.id]: 'Bを編集' });
});

test('読み込みと書き込みの間に別タブが保存しても、別の欄を消さない', () => {
  const storage = memory(), tabA = createExamStore(catalog, () => storage), tabB = createExamStore(catalog, () => storage);
  const originalSet = storage.setItem.bind(storage);
  let interleave = true;
  storage.setItem = (key, value) => {
    if (interleave) { interleave = false; tabB.set(b.id, '同時保存B'); }
    originalSet(key, value);
  };
  tabA.set(a.id, '同時保存A');
  assert.deepEqual(createExamStore(catalog, () => storage).answers, { [a.id]: '同時保存A', [b.id]: '同時保存B' });
});

test('旧形式の回答と採点を読め、解除した採点を旧データから復活させない', () => {
  const storage = memory();
  const oldAnswers = JSON.stringify({ schemaVersion: 1, answers: { [a.id]: '旧回答' } });
  const oldPractice = JSON.stringify({ schemaVersion: 1, marks: { [a.id]: { value: 'correct', snapshot: '["旧回答"]' } }, timers: {} });
  storage.setItem(EXAM_STORAGE_KEY, oldAnswers); storage.setItem(PRACTICE_STORAGE_KEY, oldPractice);
  const answers = createExamStore(catalog, () => storage), practice = createPracticeStore(catalog, () => storage);
  assert.equal(answers.answers[a.id], '旧回答');
  practice.mark(a.id, null, answers.answers); answers.set(b.id, '追加');
  assert.equal(createPracticeStore(catalog, () => storage).state.marks[a.id], undefined);
  assert.equal(storage.getItem(EXAM_STORAGE_KEY), oldAnswers);
  assert.equal(storage.getItem(PRACTICE_STORAGE_KEY), oldPractice);
});

test('回答・採点・タイマーの同時利用とバックアップ取込みは、変更した項目だけ更新する', () => {
  const storage = memory(), answers = createExamStore(catalog, () => storage);
  const tabA = createPracticeStore(catalog, () => storage), tabB = createPracticeStore(catalog, () => storage);
  answers.set(a.id, 'A'); answers.set(b.id, 'B');
  tabA.start(timerA, 1000); tabA.checkpoint(5000);
  tabB.mark(b.id, 'partial', answers.answers); tabA.mark(a.id, 'correct', answers.answers);
  tabB.mark(b.id, null, answers.answers); tabA.checkpoint(6000);
  tabB.merge({ schemaVersion: 1, marks: {}, timers: { [timerB]: { elapsedMs: 7000, startedAt: null } } });
  tabA.refresh();
  assert.equal(currentGrade(a, answers.answers, tabA.state.marks), 'correct');
  assert.equal(tabA.state.marks[b.id], undefined);
  assert.equal(tabA.state.timers[timerB].elapsedMs, 7000);
  assert.equal(tabA.state.timers[timerA].startedAt, 1000);
  const backup = parseExamBackup(exportExamBackup(answers, tabA, 7000), catalog);
  assert.equal(backup.practice.timers[timerA].elapsedMs, 6000);
  assert.equal(backup.practice.timers[timerA].startedAt, null);
});

test('終了処理なしの強制終了後は最終保存時点で止まり、翌日まで加算しない', () => {
  const storage = memory(), oldTab = createPracticeStore(catalog, () => storage);
  oldTab.start(timerA, 1000); oldTab.checkpoint(6000);
  // Discard oldTab without pause/pagehide, as on a crash or forced termination.
  const restarted = createPracticeStore(catalog, () => storage);
  assert.deepEqual(restarted.state.timers[timerA], { elapsedMs: 5000, startedAt: null });
  assert.equal(elapsedTime(restarted.state.timers[timerA], 86400000), 5000);
  restarted.start(timerA, 86400000); restarted.pause(timerA, 86403000);
  assert.equal(restarted.state.timers[timerA].elapsedMs, 8000);
});

test('別タブで計測を開始したら古いタブの計測・終了処理が新しい時計を上書きしない', () => {
  const storage = memory(), tabA = createPracticeStore(catalog, () => storage), tabB = createPracticeStore(catalog, () => storage);
  tabA.start(timerA, 1000); tabA.checkpoint(6000);
  tabB.start(timerB, 6500); tabB.checkpoint(8500);
  tabA.checkpoint(9000); tabA.pause(timerA, 10000);
  assert.equal(tabA.state.timers[timerA].startedAt, null);
  assert.equal(tabA.state.timers[timerA].elapsedMs, 5000);
  tabB.checkpoint(10500);
  const saved = createPracticeStore(catalog, () => storage).state;
  assert.equal(saved.timers[timerB].elapsedMs, 4000);
  assert.equal(saved.timers[timerA].elapsedMs, 5000);
});

test('旧版が残した実行中の時計も、起動時刻以後の不明な時間を追加しない', () => {
  const storage = memory();
  storage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, marks: {}, timers: { [timerA]: { elapsedMs: 4000, startedAt: 1000 } } }));
  const store = createPracticeStore(catalog, () => storage);
  assert.equal(elapsedTime(store.state.timers[timerA], 86400000), 4000);
});

test('保存後にデータが破損・容量不足となっても入力は保持し、元の内容を上書きしない', () => {
  const storage = memory(), store = createExamStore(catalog, () => storage);
  store.set(a.id, '保持');
  const entryKey = storage.key(0);
  storage.setItem(entryKey, '{broken'); store.set(b.id, '一時回答');
  assert.equal(store.persistent, false); assert.equal(store.answers[a.id], '保持');
  assert.equal(store.answers[b.id], '一時回答'); assert.equal(storage.getItem(entryKey), '{broken');
});

test('本文へ移動はURLの大問選択を変えず、本文へキーボードフォーカスを渡す', () => {
  let activate, prevented = false, scrolled = false, focused = false;
  const document = { querySelector: selector => selector === '.skip-link'
    ? { addEventListener: (type, handler) => { assert.equal(type, 'click'); activate = handler; } }
    : { scrollIntoView: () => { scrolled = true; }, focus: options => { assert.equal(options.preventScroll, true); focused = true; } } };
  installExamSkipLink(document); activate({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented && scrolled && focused);
});
