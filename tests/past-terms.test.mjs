import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/data.mjs';
import { compilePastTerms, verifyPastTerms } from '../scripts/past-term-data.mjs';
import { createCatalog, initialState, recordConfidence, parseState, importState, selectStudyQuestions, createSession, advanceSession, reviewSession, returnToCurrent } from '../src/domain.js';
import { createPastTermCards, eligiblePastTermCards, pastTermOccurrences, pastTermSourceLabel } from '../src/past-terms.js';
import { findQuestionByCode } from '../src/question-codes.js';

const data = await readDataset(), catalog = createCatalog(data);
const cards = catalog.pastTermCards, initial = initialState(catalog);

test('16年32冊629空欄の採否を記録し、314問を編集元から再現する', async () => {
  const { audit } = await verifyPastTerms(data.pastTerms);
  assert.equal(audit.entries.length, 629);
  assert.equal(audit.reviewedPapers.length, 32);
  assert.equal(new Set(audit.entries.map(e => e.sourceFieldId)).size, 629);
  assert.equal(audit.entries.filter(e => e.status === 'included').length, 314);
  assert.equal(cards.length, 314);
  assert.equal(new Set(cards.map(c => c.source.year)).size, 16);
  assert.deepEqual(data.pastTerms, (await compilePastTerms()).data);
  const changed = structuredClone(data.pastTerms); changed.questions[0].answer = '別の解答';
  await assert.rejects(() => verifyPastTerms(changed), /一致しません/);
});

test('図表の転記・経路値・選択肢・長文記述を用語カードへ混入させない', () => {
  for (const id of ['2025/1/3/1(4):a', '2025/2/1/4(4):ア', '2024/2/1/1(1):c', '2024/2/2/3(2):オ', '2023/2/1/2(1):c', '2018/2/1/3(1):サ', '2013/2/2/1(2):ア']) assert.ok(!cards.some(c => c.source.fieldId === id));
  assert.ok(cards.every(c => c.question.includes('［　］') && c.question.length <= 230));
  const router = cards.find(c => c.source.fieldId === '2025/1/1/1(1):b');
  assert.equal(router.answer, 'ルータ');
  assert.match(router.question, /［　］ID/);
  assert.equal(cards.find(c => c.source.fieldId === '2017/1/1/1:ウ').answer, 'Client_Hello');
  assert.match(cards.find(c => c.source.fieldId === '2023/1/2/1:キ').question, /符号化/);
});

test('既存の通常952問・予想78問と番号を保ち、T番号は順序に依存しない', () => {
  assert.equal(catalog.cards.length, 952); assert.equal(catalog.predictionCards.length, 78);
  const reversed = structuredClone(data); reversed.pastTerms.questions.reverse();
  const other = createCatalog(reversed);
  for (const c of cards) {
    assert.match(c.shortCode, /^T\d{3}$/);
    assert.equal(findQuestionByCode(other, c.shortCode).id, c.id);
  }
  assert.equal(findQuestionByCode(catalog, ' Ｔ１ ').id, cards[0].id);
  assert.notEqual(cards[0].id, catalog.cards[0].id);
});

test('年度・午後区分・非表示・苦手を組み合わせて対象数を計算する', () => {
  const state = { ...initial, settings: { ...initial.settings, enabledGroupIds: [] } };
  assert.equal(eligiblePastTermCards(catalog, state, { mode: 'thinking', direction: 'meaning', preset: 'first100' }).length, 314);
  const selected = eligiblePastTermCards(catalog, state, { pastTermYear: '2025', pastTermPeriod: '1' });
  assert.equal(selected.length, 8);
  let rated = recordConfidence(state, selected[0].id, 'unknown');
  rated = recordConfidence(rated, selected[1].id, 'unclear');
  rated = recordConfidence(rated, selected[2].id, 'understood');
  assert.equal(eligiblePastTermCards(catalog, rated, { review: 'weak' }).length, 2);
  rated.questionStates[selected[1].id].hidden = true;
  assert.equal(eligiblePastTermCards(catalog, rated, { review: 'weak', pastTermYear: '2025', pastTermPeriod: '1' }).length, 1);
  assert.equal(eligiblePastTermCards(catalog, rated, { review: 'weak', pastTermYear: '2024' }).length, 0);
});

test('過去問の用語の出題数・理解度は旧バックアップと共存する', () => {
  assert.deepEqual(parseState(JSON.stringify(initial)), initial);
  const state = recordConfidence({ ...initial, settings: { ...initial.settings, pastTermQuestionCount: 'all' } }, cards[0].id, 'unknown');
  const incoming = parseState(JSON.stringify(state));
  const merged = importState(recordConfidence(initial, catalog.cards[0].id, 'unclear'), incoming);
  assert.equal(merged.settings.pastTermQuestionCount, 'all');
  assert.equal(merged.questionStates[cards[0].id].confidence, 'unknown');
  assert.equal(merged.questionStates[catalog.cards[0].id].confidence, 'unclear');
  incoming.settings.pastTermQuestionCount = 500;
  assert.throws(() => parseState(JSON.stringify(incoming)), /出題数/);
});

test('全問出題・前の問題へ移動・理解度保持を専用コレクションでも利用できる', () => {
  const selected = selectStudyQuestions(cards, 'all', 'terms', () => 0.5);
  assert.equal(new Set(selected.map(c => c.id)).size, 314);
  let session = createSession(selected.slice(0, 5), { collection: 'past-terms' }, 5);
  session = { ...session, ratings: { [selected[0].id]: 'unknown' } };
  session = advanceSession(advanceSession(session, 'next'), 'next');
  session = reviewSession(session, 0);
  assert.equal(session.index, 2); assert.equal(session.reviewIndex, 0);
  session = returnToCurrent(session);
  assert.equal(session.index, 2); assert.equal(session.reviewIndex, null);
  assert.equal(session.ratings[selected[0].id], 'unknown');
});

test('出典は和暦・元の設問、同語の集計は収録済みカードに限定する', () => {
  assert.match(pastTermSourceLabel(cards[0].source), /令和7年度 春期 午後Ⅰ 問1 設問1\(1\) 空欄 a/);
  const term = cards.find(c => c.answer === 'NAPT'), occurrences = pastTermOccurrences(catalog, term);
  assert.ok(occurrences.cards.length > 1);
  assert.ok(occurrences.paperCount <= occurrences.cards.length);
  assert.ok(occurrences.cards.every(c => c.answer === 'NAPT'));
});

test('重複ID・壊れた出典・空欄のない文を拒否する', () => {
  for (const mutate of [
    d => d.questions.push(d.questions[0]),
    d => d.questions[0].source.problem = '../outside.pdf',
    d => d.questions[0].source.pages = [0],
    d => d.questions[0].question = '答えのない文',
    d => d.questions[0].source.fieldId = '2024/1/1/1(1):a',
  ]) { const copy = structuredClone(data.pastTerms); mutate(copy); assert.throws(() => createPastTermCards(copy), /用語/); }
});
