import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readDataset } from '../scripts/data.mjs';
import { createCatalog, initialState, eligibleCards, recordConfidence } from '../src/domain.js';
import { assignQuestionCodes, findQuestionByCode, normalizeQuestionCode } from '../src/question-codes.js';

const data = await readDataset();
const catalog = createCatalog(data);
const cards = [...catalog.cards, ...catalog.predictionCards];

test('通常952問・予想78問へ短い一意な番号を割り当て、既存番号の再割当てを防ぐ', () => {
  assert.equal(cards.length, 1030);
  assert.equal(new Set(cards.map(c => c.shortCode)).size, 1030);
  assert.ok(catalog.cards.every(c => /^Q\d{3}$/.test(c.shortCode)));
  assert.ok(catalog.predictionCards.every(c => /^P\d{2}$/.test(c.shortCode)));
  const originalCodes = [...Array.from({ length: 952 }, (_, i) => `Q${String(i + 1).padStart(3, '0')}`), ...Array.from({ length: 78 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)];
  const originalMapping = Object.fromEntries(originalCodes.map(code => [code, data.questionCodes.codes[code]]));
  assert.equal(createHash('sha256').update(JSON.stringify(originalMapping)).digest('hex'), 'c05ce1048becece14f7330a660ee895b1f1dace21bf4eb924ac67953827562dc');
});

test('配列順・出題条件・理解度が変わっても問題番号と内部保存IDを保持する', () => {
  const reordered = structuredClone(data);
  reordered.questions.reverse(); reordered.editorial.terms.reverse(); reordered.predictions.questions.reverse();
  const reversed = createCatalog(reordered);
  for (const card of cards) assert.equal(findQuestionByCode(reversed, card.shortCode).id, card.id);
  const card = catalog.cards.find(c => c.questionType === 'term');
  const state = recordConfidence(initialState(catalog), card.id, 'unknown');
  const weak = eligibleCards(catalog, state, { groupId: 'all', preset: 'all', mode: 'terms', review: 'weak' });
  assert.equal(weak[0].id, card.id);
  assert.equal(weak[0].shortCode, card.shortCode);
  assert.equal(state.questionStates[card.id].confidence, 'unknown');
});

test('質問番号は小文字・全角・ゼロ省略を照合し、不明番号を別問題へ置換しない', () => {
  for (const code of ['Q001', 'q1', ' Ｑ１ ']) assert.equal(findQuestionByCode(catalog, code).id, 'Q_TLS_KEY_L1');
  assert.equal(findQuestionByCode(catalog, 'p1').id, 'PRED_N001');
  for (const input of ['Q000', 'P00', '123', 'QUESTION 01', 'Q1.5', 'Q-1', null]) assert.equal(normalizeQuestionCode(input), null);
  assert.equal(findQuestionByCode(catalog, 'Q99999'), null);
});

test('未登録・重複・不正な番号を拒否し、欠番を予約として残せる', () => {
  for (const mutate of [
    r => delete r.codes.Q001,
    r => r.codes.Q999 = r.codes.Q001,
    r => { r.codes.Q1 = r.codes.Q001; delete r.codes.Q001; },
    r => { r.codes.P99 = r.codes.Q001; delete r.codes.Q001; },
  ]) {
    const registry = structuredClone(data.questionCodes); mutate(registry);
    assert.throws(() => assignQuestionCodes(cards, registry));
  }
  const registry = structuredClone(data.questionCodes);
  registry.codes.Q999 = 'RESERVED_REMOVED_CARD';
  assert.equal(assignQuestionCodes(cards, registry).length, 1030);
  assert.throws(() => assignQuestionCodes([...cards, { id: 'NEW_QUESTION' }], registry));
});
