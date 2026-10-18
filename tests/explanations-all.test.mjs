import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadAllExplanations } from '../scripts/explanation-data.mjs';
import { validateExplanations, explanationFor } from '../src/exam-explanations.js';
import { gradeSummary } from '../src/exam-practice.js';

const catalog = JSON.parse(await readFile(new URL('../data/exams/catalog.json', import.meta.url)));
const all = await loadAllExplanations(catalog);
const firstEdition = JSON.parse(await readFile(new URL('../data/exams/explanations-2025.json', import.meta.url), 'utf8'));

test('全16回・80大問・1345項目に原問IDと順序が一致する解説がある', () => {
  assert.equal(new Set(catalog.papers.map(p => p.year)).size, 16);
  assert.equal(all.questions.length, 80);
  assert.equal(all.questions.reduce((n, q) => n + q.fields.length, 0), 1345);
  for (const paper of catalog.papers) for (const q of paper.questions) {
    const entry = explanationFor(all, paper, q);
    assert.ok(entry, `${paper.id}-${q.number}`);
    assert.deepEqual(entry.fields.map(f => f.id), q.fields.map(f => f.id));
  }
});

test('公開用データでは大問の不足・重複・別大問の回答IDを拒否する', () => {
  const missing = structuredClone(all); missing.questions.pop();
  assert.throws(() => validateExplanations(missing, catalog, { complete: true }), /そろって/);
  const duplicate = structuredClone(all); duplicate.questions.push(duplicate.questions[0]);
  assert.throws(() => validateExplanations(duplicate, catalog, { complete: true }), /大問ID/);
  const mismatched = structuredClone(all);
  mismatched.questions[0].fields[0].id = all.questions[1].fields[0].id;
  assert.throws(() => validateExplanations(mismatched, catalog, { complete: true }), /解説が不足/);
});

test('不備3項目の解説は採点対象外を明記し、24項目で自己採点する', () => {
  const paper = catalog.papers.find(p => p.id === '2024-2'), q = paper.questions[1];
  const entry = explanationFor(all, paper, q);
  assert.equal(q.fields.filter(f => f.invalid).length, 3);
  for (const field of q.fields.filter(f => f.invalid)) {
    const detail = entry.fields.find(f => f.id === field.id);
    assert.match(detail.answer, /採点対象外/);
    assert.match(detail.grading, /採点対象外/);
  }
  const summary = gradeSummary(q, {}, {});
  assert.equal(summary.total, 24); assert.equal(summary.excluded, 3);
});

test('原問に依存する計算・経路の説明と先行公開2025年版を保持する', () => {
  const field = id => all.questions.flatMap(q => q.fields).find(f => f.id === id);
  assert.match(field('2009/2/1/3(5):a').steps.join(' '), /192μ秒/);
  assert.match(field('2012/1/2/1(2)').steps.join(' '), /56÷12/);
  assert.match(field('2013/2/1/2(5)').answer, /L3SW1→L3SW2→L3SW1/);
  assert.match(field('2015/2/1/4(2)').answer, /L2SW/);
  assert.deepEqual(all.questions.filter(q => q.id.startsWith('2025-')), firstEdition.questions);
});
