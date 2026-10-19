import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyExamAnswerLimits } from '../scripts/exam-answer-limits.mjs';
import { answerLengthStatus, answerKeys, createExamStore } from '../src/exams.js';

const catalog = JSON.parse(await readFile(new URL('../data/exams/catalog.json', import.meta.url)));
const source = JSON.parse(await readFile(new URL('../data/exams/answer-limits.json', import.meta.url)));
const withLimits = applyExamAnswerLimits(catalog, source);

test('全32冊の確認済み原本から欄ごとの制限を追加し、回答キー・複合欄順序を保持する', () => {
  assert.equal(source.reviewedPapers.length, 32);
  assert.deepEqual(withLimits.papers, catalog.papers);
  assert.deepEqual(withLimits.papers.flatMap(p => p.questions.flatMap(answerKeys)), catalog.papers.flatMap(p => p.questions.flatMap(answerKeys)));
  assert.equal(withLimits.answerLimits['2025/1/2/3(3)#1'].max, 25);
  assert.equal(withLimits.answerLimits['2025/1/2/3(3)#2'].max, 45);
  assert.equal(withLimits.answerLimits['2025/1/2/2(1)'].max, 40);
  assert.equal(withLimits.answerLimits['2025/2/1/2(6)'].max, 20);
  assert.equal(withLimits.answerLimits['2009/2/1/3(4)'].max, 50);
  assert.equal(withLimits.answerLimits['2021/1/2/3(3)'], undefined);
  assert.equal(withLimits.answerLimits['2021/1/2/3(1)'].max, 25);
  assert.equal(withLimits.answerLimits['2014/1/2/2(5):a'], undefined);
  assert.equal(withLimits.answerLimits['2014/1/2/2(5):b'].max, 20);
});

test('上限・超過・指定なし・複数条件を区別し、補助文字も一文字として数える', () => {
  assert.deepEqual(answerLengthStatus('', { max: 50 }), { text: '0/50字', exceeded: false });
  assert.deepEqual(answerLengthStatus('あ'.repeat(50), { max: 50 }), { text: '50/50字', exceeded: false });
  assert.deepEqual(answerLengthStatus('あ'.repeat(51), { max: 50 }), { text: '51/50字（上限超過）', exceeded: true });
  assert.equal(answerLengthStatus('𠮷🙂').text, '2字（字数指定なし）');
  assert.equal(answerLengthStatus('回答', withLimits.answerLimits['2017/2/2/5(5)']).text, '2字（問題20字以内・理由40字以内）');
});

test('不明な欄・誤った上限・欄数・原本・確認漏れは公開ビルドへ入れない', () => {
  const change = mutate => { const data = structuredClone(source); mutate(data); assert.throws(() => applyExamAnswerLimits(catalog, data)); };
  change(d => { d.limits.nope = { max: [30], page: 1 }; });
  change(d => { d.limits['2025/1/1/1(2)'].max = [-1]; });
  change(d => { d.limits['2025/1/1/1(2)'].max = [30, 40]; });
  change(d => { d.limits['2025/1/1/1(2)'].page = 999; });
  change(d => { d.sources['2025-1'].sha256 = 'changed'; });
  change(d => { d.reviewedPapers.pop(); });
});

test('既存の上限超過回答も切り捨てず保存・バックアップ・再読込みできる', () => {
  const map = new Map(), storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const key = '2025/1/1/1(2)', value = 'あ'.repeat(50);
  const store = createExamStore(withLimits, () => storage); store.set(key, value);
  assert.equal(JSON.parse(store.export()).answers[key], value);
  assert.equal(createExamStore(withLimits, () => storage).answers[key], value);
  assert.equal(answerLengthStatus(value, withLimits.answerLimits[key]).exceeded, true);
});
