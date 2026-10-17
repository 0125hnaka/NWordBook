import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readDataset } from '../scripts/data.mjs';
import { parsePredictionSource } from '../scripts/import-predictions.mjs';
import { createCatalog, initialState, eligibleCards, selectStudyQuestions, recordConfidence, parseState, importState, createSession, advanceSession, reviewSession, returnToCurrent } from '../src/domain.js';
import { validatePredictions, eligiblePredictionCards } from '../src/predictions.js';

const data = await readDataset();
const catalog = createCatalog(data);
const fresh = () => initialState(catalog);
const mainFilter = { groupId: 'all', preset: 'all', mode: 'terms', direction: 'both' };

test('追加資料の72短問と6複合演習を条件・解答・注意点を含めて取り込む', async () => {
  const source = await readFile(new URL('../data/predictions/source.md', import.meta.url), 'utf8');
  assert.deepEqual(parsePredictionSource(source), data.predictions);
  assert.equal(catalog.predictionCards.length, 78);
  assert.equal(catalog.predictionCards.filter(c => c.kind === 'short').length, 72);
  assert.equal(catalog.predictionCards.filter(c => c.kind === 'composite').length, 6);
  assert.equal(new Set(catalog.predictionCards.map(c => c.id)).size, 78);
  for (let n = 1; n <= 72; n++) assert.ok(catalog.predictionCards.some(c => c.code === `N${String(n).padStart(3, '0')}`));
  assert.ok(catalog.predictionCards.filter(c => c.kind === 'composite').every(c => c.question.startsWith('条件：') && c.relatedPredictionCodes.length));
  assert.deepEqual(data.predictions.questions.find(c => c.code === '演習1').relatedPredictionCodes.sort(), ['N013', 'N014', 'N015', 'N032', 'N070']);
});

test('通常教材952枚・初期用語139枚・混合759枚と頻度を変更しない', () => {
  assert.equal(catalog.cards.length, 952);
  const state = fresh();
  assert.equal(eligibleCards(catalog, state, mainFilter).length, 139);
  assert.equal(eligibleCards(catalog, state, { ...mainFilter, mode: 'mixed' }).length, 759);
  for (const mode of ['terms', 'thinking', 'mixed']) for (const allow of [false, true]) {
    state.settings.allowUnverifiedSupplement = allow;
    assert.ok(eligibleCards(catalog, state, { ...mainFilter, mode }).every(c => !c.prediction && !c.id.startsWith('PRED_')));
  }
  assert.deepEqual(catalog.atoms.map(a => a.frequency), data.atoms.map(a => a.frequency));
  assert.ok(catalog.predictionCards.every(c => !c.atom.verified && c.examMapping === 'unresearched' && !c.sourceRefs.length));
});

test('予想問題の種類・理解度・非表示を絞り込み、通常の分野や用語設定には左右されない', () => {
  const state = fresh();
  state.settings.enabledGroupIds = [];
  assert.equal(eligiblePredictionCards(catalog, state, { ...mainFilter, predictionScope: 'all' }).length, 78);
  assert.equal(eligiblePredictionCards(catalog, state, { predictionScope: 'short' }).length, 72);
  assert.equal(eligiblePredictionCards(catalog, state, { predictionScope: 'composite' }).length, 6);
  const [first, second] = catalog.predictionCards;
  let rated = recordConfidence(state, first.id, 'unknown');
  rated = recordConfidence(rated, second.id, 'unclear');
  rated.questionStates[first.id].hidden = true;
  assert.deepEqual(eligiblePredictionCards(catalog, rated, { review: 'weak' }).map(c => c.id), [second.id]);
  rated = recordConfidence(rated, second.id, 'understood');
  assert.deepEqual(eligiblePredictionCards(catalog, rated, { review: 'weak' }), []);
});

test('全件・候補不足・空候補で正常に選問し、予想問題の見直しでも進捗を保持する', () => {
  const pool = eligiblePredictionCards(catalog, fresh());
  const selected = selectStudyQuestions(pool, 'all', 'thinking');
  assert.equal(selected.length, 78);
  assert.equal(new Set(selected.map(c => c.id)).size, 78);
  assert.equal(selectStudyQuestions(pool.slice(0, 2), 20, 'thinking').length, 2);
  assert.deepEqual(selectStudyQuestions([], 'all', 'thinking'), []);
  let session = createSession(selected, { collection: 'predictions' }, 'all');
  session = advanceSession(advanceSession(session, 'next'), 'next');
  session = returnToCurrent(reviewSession(session, 0));
  assert.equal(session.index, 2);
  assert.equal(session.completed, 2);
  assert.equal(session.filter.collection, 'predictions');
});

test('予想問題の出題数と理解度を保存・移行し、通常の設定を保持する', () => {
  const state = fresh();
  state.settings.questionCount = 5;
  state.settings.predictionQuestionCount = 'all';
  const rated = recordConfidence(state, 'PRED_N001', 'unknown');
  const result = importState(fresh(), parseState(JSON.stringify(rated)));
  assert.equal(result.settings.questionCount, 5);
  assert.equal(result.settings.predictionQuestionCount, 'all');
  assert.equal(result.questionStates.PRED_N001.confidence, 'unknown');
  assert.equal(eligibleCards(catalog, result, mainFilter).length, 139);
  state.settings.predictionQuestionCount = 0;
  assert.throws(() => parseState(JSON.stringify(state)));
});

test('予想問題にIPA確認済み・参照切れ・危険なURL・空解答を混入させない', () => {
  for (const mutate of [
    d => d.questions[0].examMapping = 'verified',
    d => d.questions[0].id = d.questions[1].id,
    d => d.questions[0].answer = ' ',
    d => d.questions[0].relatedAtomIds = ['KA_MISSING'],
    d => d.questions.at(-1).relatedPredictionCodes = ['N999'],
    d => d.questions[0].technicalSources[0].url = 'javascript:alert(1)',
  ]) {
    const corrupted = structuredClone(data.predictions); mutate(corrupted);
    assert.throws(() => validatePredictions(corrupted, new Set(data.atoms.map(a => a.id))));
  }
});

test('計算の前提・単位とIPA準拠の表記・識別子を保持する', () => {
  const byCode = code => catalog.predictionCards.find(c => c.code === code);
  assert.match(byCode('N013').answer, /200Mb\/s/);
  assert.match(byCode('N044').answer, /95.2kb\/s/);
  assert.match(byCode('N068').answer, /27回/);
  assert.match(byCode('N009').answer, /NEXT_HOP/);
  assert.match(byCode('演習3').answer, /サプリカント・オーセンティケータ・認証サーバ/);
});
