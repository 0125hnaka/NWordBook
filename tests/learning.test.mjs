import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/data.mjs';
import { createCatalog, initialState, eligibleCards, selectStudyQuestions, recordConfidence, parseState, importState } from '../src/domain.js';
import { validateEditorial } from '../src/content.js';
import { createStateStore } from '../src/storage.js';

const data = await readDataset();
const catalog = createCatalog(data);
const filter = { groupId: 'all', preset: 'all', mode: 'terms', direction: 'both', review: 'all' };

test('50用語の意味・名前カード100枚を追加し、原本852問は保持する', () => {
  assert.equal(data.questions.length, 852);
  assert.equal(data.editorial.terms.length, 50);
  assert.equal(catalog.cards.length, 952);
  assert.equal(new Set(catalog.cards.map(c => c.id)).size, 952);
  assert.ok(catalog.cards.filter(c => c.editorialAdded).every(c => c.atom && c.group && c.sourceRefs.length && c.questionType === 'term'));
});
test('用語モードは意味と名前の両方向を選べ、思考問題を混ぜない', () => {
  const state = initialState(catalog);
  const terms = eligibleCards(catalog, state, filter);
  assert.ok(terms.length > 100);
  assert.ok(terms.every(c => c.questionType === 'term'));
  for (const direction of ['meaning', 'name']) {
    const cards = eligibleCards(catalog, state, { ...filter, direction });
    assert.ok(cards.length > 0);
    assert.ok(cards.every(c => c.termDirection === direction));
  }
  const thinking = eligibleCards(catalog, state, { ...filter, mode: 'thinking' });
  assert.ok(thinking.length > 0 && thinking.every(c => c.questionType !== 'term'));
});
test('追加用語も分野・推奨100・非表示設定を守る', () => {
  const state = initialState(catalog);
  const card = eligibleCards(catalog, state, filter).find(c => c.editorialAdded);
  state.settings.enabledGroupIds = [];
  assert.equal(eligibleCards(catalog, state, filter).length, 0);
  state.settings.enabledGroupIds = [card.group.id];
  state.questionStates[card.id] = { hidden: true };
  assert.ok(!eligibleCards(catalog, state, filter).some(c => c.id === card.id));
  const first = eligibleCards(catalog, state, { ...filter, preset: 'first100' });
  assert.ok(first.every(c => catalog.first100Set.has(c.knowledgeAtomId)));
});
test('両方モードでは5/10/20問を用語と思考に分散し原子と問題IDを重複させない', () => {
  const candidates = eligibleCards(catalog, initialState(catalog), { ...filter, mode: 'mixed' });
  for (const count of [5, 10, 20]) {
    const selected = selectStudyQuestions(candidates, count, 'mixed');
    assert.equal(selected.length, count);
    assert.equal(selected.filter(c => c.questionType === 'term').length, Math.ceil(count / 2));
    assert.equal(new Set(selected.map(c => c.id)).size, count);
    assert.equal(new Set(selected.map(c => c.knowledgeAtomId)).size, count);
  }
});
test('片方の形式や候補が不足していても重複せず実際の件数で出題する', () => {
  assert.deepEqual(selectStudyQuestions([], 20, 'mixed'), []);
  const candidates = eligibleCards(catalog, initialState(catalog), filter).slice(0, 4);
  const selected = selectStudyQuestions(candidates, 20, 'mixed');
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected.map(c => c.id)).size, 4);
});
test('理解度記録は既存の非表示やメモを保持し、選び直しで最新値になる', () => {
  const state = initialState(catalog);
  state.questionStates.x = { hidden: true, note: 'keep' };
  const next = recordConfidence(state, 'x', 'unclear', '2026-10-16T14:00:00.000Z');
  const changed = recordConfidence(next, 'x', 'unknown', '2026-10-16T14:01:00.000Z');
  assert.equal(state.questionStates.x.confidence, undefined);
  assert.equal(changed.questionStates.x.hidden, true);
  assert.equal(changed.questionStates.x.note, 'keep');
  assert.equal(changed.questionStates.x.confidence, 'unknown');
  assert.equal(changed.questionStates.x.lastReviewed, '2026-10-16T14:01:00.000Z');
});
test('わからない・知らないの復習は分野や非表示を迂回せず、わかったに変えると外れる', () => {
  let state = initialState(catalog);
  const [a, b, c] = eligibleCards(catalog, state, filter);
  state = recordConfidence(state, a.id, 'unclear');
  state = recordConfidence(state, b.id, 'unknown');
  state = recordConfidence(state, c.id, 'understood');
  const weak = { ...filter, review: 'weak' };
  assert.equal(eligibleCards(catalog, state, weak).length, 2);
  state = recordConfidence(state, a.id, 'understood');
  assert.deepEqual(eligibleCards(catalog, state, weak).map(c => c.id), [b.id]);
  state.questionStates[b.id].hidden = true;
  assert.equal(eligibleCards(catalog, state, weak).length, 0);
  state.questionStates[b.id].hidden = false;
  state.settings.enabledGroupIds = [];
  assert.equal(eligibleCards(catalog, state, weak).length, 0);
});
test('旧保存形式の読込み、理解度の保存・再読込み・エクスポート移行', () => {
  const legacy = initialState(catalog); delete legacy.settings.studyMode; delete legacy.settings.termDirection;
  assert.doesNotThrow(() => parseState(JSON.stringify(legacy)));
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_, text) => raw = text };
  const store = createStateStore(catalog, () => storage);
  store.save(recordConfidence(store.state, 'TERM_TLS_TERMINATION_meaning', 'unknown'));
  const restored = createStateStore(catalog, () => storage);
  assert.equal(restored.state.questionStates.TERM_TLS_TERMINATION_meaning.confidence, 'unknown');
  assert.equal(importState(initialState(catalog), parseState(raw)).questionStates.TERM_TLS_TERMINATION_meaning.confidence, 'unknown');
});
test('不正な理解度・日時・学習モードをインポートしない', () => {
  for (const mutate of [s => s.settings.studyMode = 'bad', s => s.settings.termDirection = 'bad', s => s.questionStates.x = { hidden: false, confidence: 'correct' }, s => s.questionStates.x = { hidden: false, lastReviewed: 'bad-date' }]) {
    const state = initialState(catalog); mutate(state); assert.throws(() => parseState(JSON.stringify(state)));
  }
  assert.throws(() => recordConfidence(initialState(catalog), '__proto__', 'unknown'));
});
test('40問を個別に具体化し、全カードに答える対象を示す', () => {
  assert.equal(catalog.cards.filter(c => c.editorialRevised).length, 40);
  assert.ok(catalog.cards.every(c => c.answerFocus?.trim()));
  assert.ok(catalog.cards.every(c => !c.question.startsWith('次の原則が成り立つ仕組みを説明せよ。')));
  const nat = catalog.cards.find(c => c.id === 'Q_NAT_ENTRY_L3');
  assert.match(nat.answer, /枯渇/);
  assert.ok(!nat.answer.includes('20,000'));
  assert.match(catalog.cards.find(c => c.id === 'Q_CAP_FAIL_L3').answer, /一台/);
});
test('編集教材の参照切れ・重複・空の修正解答を検出する', () => {
  for (const mutate of [d => d.editorial.terms[0].atomId = 'missing', d => d.editorial.terms[1].id = d.editorial.terms[0].id, d => d.editorial.questionRevisions[0].id = 'missing', d => d.editorial.questionRevisions[0].answer = '']) {
    const broken = structuredClone(data); mutate(broken); assert.throws(() => validateEditorial(broken));
  }
});
