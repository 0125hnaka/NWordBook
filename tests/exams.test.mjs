import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateExamCatalog, parseExamSelection, answerKeys, formatExamAnswers, parseExamAnswers, createExamStore, identifyExamPdf, MAX_ANSWER_LENGTH, EXAM_STORAGE_KEY } from '../src/exams.js';
const catalog = validateExamCatalog(JSON.parse(await readFile(new URL('../data/exams/catalog.json', import.meta.url))));
const questions = catalog.papers.flatMap(p => p.questions);
const key = questions[0].fields[0].id;
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }; };

test('公式の公開16回・32冊・80大問の全回答欄を含み、単語帳の除外設問も残す', () => {
  assert.equal(catalog.papers.length, 32); assert.equal(questions.length, 80);
  assert.equal(new Set(catalog.papers.map(p => p.year)).size, 16);
  assert.equal(catalog.papers.some(p => p.year === 2020), false);
  assert.equal(questions.reduce((n, q) => n + q.fields.length, 0), 1345);
  assert.equal(questions.reduce((n, q) => n + answerKeys(q).length, 0), 1559);
  assert.equal(questions.flatMap(q => q.fields).filter(f => f.invalid).length, 3);
  assert.equal(new Set(questions.flatMap(answerKeys)).size, 1559);
  assert.equal(catalog.papers.flatMap(p => p.documents).length, 96);
});

test('公開後に既存の回答ID・複合欄の順序を意図せず変更しない', () => {
  const digest = createHash('sha256').update(JSON.stringify(questions.flatMap(q => q.fields))).digest('hex');
  assert.equal(digest, '9044b33977d31f448f20e9d5d918c364aa456d2d04b1922b4756ac0f56359220');
});

test('複合回答を原問に合わせて分ける（2025 IPv6・2013フレーム表）', () => {
  const fields = questions.flatMap(q => q.fields);
  assert.deepEqual(fields.find(f => f.id === '2025/2/2/3(4)').parts, ['理由', '処理']);
  assert.equal(fields.find(f => f.id === '2013/1/3/2(2)').parts.length, 6);
});

test('不正・重複した設問IDやIPA以外のPDF参照を拒否する', () => {
  const duplicate = structuredClone(catalog); duplicate.papers[0].questions[0].fields.push(duplicate.papers[0].questions[0].fields[0]);
  assert.throws(() => validateExamCatalog(duplicate));
  const foreign = structuredClone(catalog); foreign.papers[0].documents[0].url = 'https://example.com/exam.pdf';
  assert.throws(() => validateExamCatalog(foreign));
});

test('年度・午後区分・大問を復元し、不正なリンクは既定値に戻す', () => {
  assert.equal(parseExamSelection('#2009-2-2', catalog).question.number, 2);
  assert.equal(parseExamSelection('#2009-2-2', catalog).paper.year, 2009);
  assert.equal(parseExamSelection('#2025-2-3', catalog).paper.id, '2025-1');
  assert.equal(parseExamSelection('#answer-summary', catalog).question.number, 1);
});

test('回答まとめは選択中の大問だけを設問番号・未回答表示付きで出す', () => {
  const q = catalog.papers.find(p => p.id === '2025-2').questions[1];
  const text = formatExamAnswers(catalog.papers.find(p => p.id === '2025-2'), q, { '2025/2/2/3(4)#1': '理由の回答', [key]: '別大問の答え' });
  assert.match(text, /2025年度 春期.*午後Ⅱ 問2/);
  assert.match(text, /設問3\(4\)［理由］\n理由の回答/);
  assert.match(text, /設問3\(4\)［処理］\n（未回答）/);
  assert.doesNotMatch(text, /別大問の答え/);
});

test('複数年度の回答を保存・再読込みし、バックアップで対象欄だけを更新する', () => {
  const storage = memory(), s = createExamStore(catalog, () => storage), otherKey = answerKeys(questions.at(-1))[0];
  s.set(key, '保存する答え'); s.set(otherKey, '別年度');
  const restored = createExamStore(catalog, () => storage);
  assert.equal(restored.answers[key], '保存する答え');
  restored.merge({ schemaVersion: 1, answers: { [key]: '更新した答え' } });
  assert.equal(restored.answers[otherKey], '別年度');
  assert.deepEqual(parseExamAnswers(restored.export(), catalog).answers, restored.answers);
});

test('破損データを上書きせず一時保存に切り替える', () => {
  const storage = memory(); storage.setItem(EXAM_STORAGE_KEY, '{broken');
  const s = createExamStore(catalog, () => storage); s.set(key, '一時回答');
  assert.equal(s.persistent, false); assert.equal(s.answers[key], '一時回答');
  assert.equal(storage.getItem(EXAM_STORAGE_KEY), '{broken'); assert.ok(s.notice);
});

test('保存容量エラーでも入力中の回答と書き出しを保持する', () => {
  const s = createExamStore(catalog, () => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
  s.set(key, '消さない'); assert.equal(s.persistent, false);
  assert.equal(JSON.parse(s.export()).answers[key], '消さない');
});

test('不明な設問・長すぎる回答・他機能のJSONを回答として取り込まない', () => {
  for (const data of [{ schemaVersion: 1, answers: { nope: 'x' } }, { schemaVersion: 1, answers: { [key]: 'x'.repeat(MAX_ANSWER_LENGTH + 1) } }, { schemaVersion: 1, settings: {} }]) assert.throws(() => parseExamAnswers(JSON.stringify(data), catalog));
});

test('PDFは名前でなく内容ハッシュで識別し、改変PDFを拒否する', async () => {
  const doc = catalog.papers[0].documents[0];
  const file = new File(['%PDF-1.7 test'], 'renamed.pdf', { type: 'application/pdf' });
  const digest = () => Uint8Array.from(doc.sha256.match(/../g).map(v => parseInt(v, 16))).buffer;
  assert.equal((await identifyExamPdf(file, catalog, digest)).id, doc.id);
  await assert.rejects(() => identifyExamPdf(file, catalog, () => new ArrayBuffer(32)));
  await assert.rejects(() => identifyExamPdf(new File(['not a PDF'], 'exam.pdf'), catalog, digest));
});
