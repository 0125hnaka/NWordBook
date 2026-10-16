import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, initialState, eligibleCards, isEligible, selectQuestions, createSession, advanceSession, parseState, importState, sourceLabel, safeUrl, validateDataset, MAX_IMPORT_BYTES, STORAGE_KEY } from '../src/domain.js';
import { createStateStore } from '../src/storage.js';
import { readDataset } from '../scripts/data.mjs';
import { validate } from '../scripts/validate.mjs';

const data = await readDataset();
const catalog = createCatalog({ ...data, editorial: undefined });
const filter = { groupId: 'all', preset: 'all' };
const fresh = () => initialState(catalog);
const copy = value => structuredClone(value);

test('原本ハッシュ、基準件数、100原子を検証する', async () => { await validate(); });
test('初期状態は659問、全分野ONは836問、未確認ONは852問', () => {
  const state = fresh();
  assert.equal(eligibleCards(catalog, state, filter).length, 659);
  state.settings.enabledGroupIds = catalog.profile.groups.map(g => g.id);
  assert.equal(eligibleCards(catalog, state, filter).length, 836);
  state.settings.allowUnverifiedSupplement = true;
  assert.equal(eligibleCards(catalog, state, filter).length, 852);
});
test('未確認・分野・非表示の条件が互いを迂回しない', () => {
  const card = catalog.cards.find(c => !c.atom.verified);
  const state = fresh();
  assert.equal(isEligible(card, state, filter), false);
  state.settings.allowUnverifiedSupplement = true;
  assert.equal(isEligible(card, state, filter), true);
  state.settings.enabledGroupIds = [];
  assert.equal(isEligible(card, state, filter), false);
  state.settings.enabledGroupIds = [card.group.id];
  state.questionStates[card.id] = { hidden: true };
  assert.equal(isEligible(card, state, filter), false);
  state.questionStates[card.id].hidden = false;
  state.settings.allowUnverifiedSupplement = false;
  assert.equal(isEligible(card, state, filter), false);
});
test('一般の無効問題は未確認ONでも有効にならない', () => {
  const card = { ...catalog.cards.find(c => c.atom.verified), defaultEnabled: false };
  const state = fresh(); state.settings.allowUnverifiedSupplement = true;
  assert.equal(isEligible(card, state, filter), false);
});
test('同原子の別カードは非表示に巻き込まない', () => {
  const state = fresh();
  const card = catalog.cards[0];
  state.questionStates[card.id] = { hidden: true };
  const siblings = eligibleCards(catalog, state, filter).filter(c => c.knowledgeAtomId === card.knowledgeAtomId);
  assert.ok(siblings.length > 0);
  assert.ok(!siblings.some(c => c.id === card.id));
  const reloaded = parseState(JSON.stringify(state));
  assert.equal(eligibleCards(catalog, reloaded, filter).length, 658);
});
test('分野指定、推奨100、0分野は現在の設定を守る', () => {
  const state = fresh();
  const routing = eligibleCards(catalog, state, { groupId: 'routing', preset: 'all' });
  assert.equal(routing.length, 118);
  assert.ok(routing.every(c => c.group.id === 'routing'));
  const first = eligibleCards(catalog, state, { groupId: 'all', preset: 'first100' });
  assert.ok(first.length > 0 && first.length < 659);
  assert.ok(first.every(c => catalog.first100Set.has(c.knowledgeAtomId)));
  state.settings.enabledGroupIds = [];
  assert.deepEqual(eligibleCards(catalog, state, filter), []);
});
test('5/10/20問は非復元、原子を優先して分散、入力候補を変更しない', () => {
  const candidates = eligibleCards(catalog, fresh(), filter);
  const original = candidates.map(c => c.id);
  for (const n of [5, 10, 20]) {
    const selected = selectQuestions(candidates, n);
    assert.equal(selected.length, n);
    assert.equal(new Set(selected.map(c => c.id)).size, n);
    assert.equal(new Set(selected.map(c => c.knowledgeAtomId)).size, n);
  }
  assert.deepEqual(candidates.map(c => c.id), original);
});
test('候補不足・0件・同原子だけでも終了しIDを重複させない', () => {
  assert.deepEqual(selectQuestions([], 20), []);
  const subset = catalog.cards.filter(c => c.knowledgeAtomId === catalog.cards[0].knowledgeAtomId);
  const selected = selectQuestions([...subset, ...subset], 20);
  assert.equal(selected.length, subset.length);
  assert.equal(new Set(selected.map(c => c.id)).size, subset.length);
});
test('固定キュー、学習・非表示の別集計、残り非表示のスキップ', () => {
  const cards = selectQuestions(catalog.cards, 5);
  const session = createSession(cards, filter, 5);
  const queued = [...session.queue];
  let next = advanceSession(session, 'next');
  next = advanceSession(next, 'hide', new Set([queued[2]]));
  assert.equal(next.completed, 1); assert.equal(next.hidden, 2); assert.equal(next.index, 3);
  next = advanceSession(next, 'next'); next = advanceSession(next, 'next');
  assert.equal(next.index, 5); assert.equal(next.completed + next.hidden, 5);
  assert.deepEqual(next.queue, queued);
  assert.equal(session.index, 0);
  assert.equal(advanceSession(next, 'next'), next);
});
test('壊れた形式、サイズ超過、無効な設定を拒否する', () => {
  for (const input of ['{', '{}', '[]', 'null', ' '.repeat(MAX_IMPORT_BYTES + 1)]) assert.throws(() => parseState(input));
  for (const mutate of [s => s.settings.questionCount = 6, s => s.settings.allowUnverifiedSupplement = 'yes', s => s.settings.enabledGroupIds = ['a', 'a'], s => s.questionStates.x = { hidden: 1 }]) {
    const state = fresh(); mutate(state); assert.throws(() => parseState(JSON.stringify(state)));
  }
  const hostile = JSON.stringify(fresh()).replace('"questionStates":{}', '"questionStates":{"__proto__":{"hidden":true}}');
  assert.throws(() => parseState(hostile));
});
test('インポートは不明IDを保持し、同IDを更新し、未確認を勝手にONにしない', () => {
  const current = fresh(); current.questionStates.old = { hidden: true, note: 'retain' };
  const incoming = fresh(); incoming.settings.allowUnverifiedSupplement = true;
  incoming.questionStates.new = { hidden: true };
  const parsed = parseState(JSON.stringify(incoming));
  const result = importState(current, parsed);
  assert.equal(result.questionStates.old.note, 'retain'); assert.equal(result.questionStates.new.hidden, true);
  assert.equal(result.settings.allowUnverifiedSupplement, false);
  assert.equal(importState(current, parsed, true).settings.allowUnverifiedSupplement, true);
  incoming.questionStates.old = { hidden: false };
  assert.equal(importState(current, incoming).questionStates.old.hidden, false);
});
test('保存・再読込みで分野と非表示が復元し、教材版変更でも不明IDを保持', () => {
  const memory = new Map();
  const storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  const store = createStateStore(catalog, () => storage);
  const next = fresh(); next.questionStates.unknown = { hidden: true }; next.settings.enabledGroupIds = [];
  store.save(next);
  const reloaded = createStateStore({ ...catalog, manifest: { datasetVersion: 'new-version' } }, () => storage);
  assert.equal(reloaded.state.questionStates.unknown.hidden, true);
  assert.equal(reloaded.state.datasetVersion, 'new-version');
  assert.deepEqual(reloaded.state.settings.enabledGroupIds, []);
});
test('保存破損・アクセス拒否は原本を上書きせず一時保存へ退避', () => {
  let writes = 0;
  const storage = { getItem: () => 'broken-json', setItem: () => writes++ };
  const store = createStateStore(catalog, () => storage);
  assert.equal(store.persistent, false); assert.ok(store.notice);
  store.save({ ...fresh(), questionStates: { old: { hidden: true } } });
  assert.equal(writes, 0); assert.equal(store.state.questionStates.old.hidden, true);
  const denied = createStateStore(catalog, () => { throw new Error('denied'); });
  assert.equal(denied.persistent, false);
});
test('容量超過でも状態はメモリーに保持する', () => {
  const store = createStateStore(catalog, () => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
  const state = fresh(); state.questionStates.x = { hidden: true }; store.save(state);
  assert.equal(store.persistent, false); assert.equal(store.state.questionStates.x.hidden, true);
});
test('出典ラベルは本文・未確認を区別し、安全なリンクだけ許可する', () => {
  const body = { verified: true, year: 2023, session: '春期', section: '午後II', questionNo: 1, subQuestion: null, problemPdfPages: [2, 3] };
  assert.match(sourceLabel(body), /本文・PDF2・3ページ/);
  assert.equal(sourceLabel({ verified: false }), 'IPA設問対応未確認');
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///x', null, 'invalid']) assert.equal(safeUrl(url), null);
  assert.equal(safeUrl('https://www.ipa.go.jp/test'), 'https://www.ipa.go.jp/test');
  assert.ok(catalog.cards.some(c => c.sourceRefs.length > 1));
});
test('参照切れ・重複・空欄・不正な分類や分野の変更を検出する', () => {
  for (const mutate of [
    d => d.questions[0].knowledgeAtomId = 'missing',
    d => d.questions[0].id = d.questions[1].id,
    d => d.questions[0].answer = ' ',
    d => d.questions[0].questionType = 'role',
    d => d.questions[0].classification = '?',
    d => d.atoms[0].priority = 'Z',
    d => d.profile.groups[0].knowledgeAtomIds.push(d.profile.groups[0].knowledgeAtomIds[0]),
    d => d.profile.groups[0].knowledgeAtomIds.pop(),
    d => d.first100[0] = 'missing',
  ]) {
    const corrupted = copy(data); mutate(corrupted); assert.throws(() => validateDataset(corrupted));
  }
});
