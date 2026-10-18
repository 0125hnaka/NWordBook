import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/data.mjs';
import { createCatalog, initialState, eligibleCards, studyModeCounts, recordConfidence } from '../src/domain.js';
import { eligiblePredictionCards, predictionScopeCounts } from '../src/predictions.js';

const catalog = createCatalog(await readDataset());
const filter = { groupId: 'all', preset: 'all', mode: 'terms', direction: 'both', review: 'all' };

test('各学び方の件数は初期139/620/759問で、分野・方向・推奨100に追従する', () => {
  const state = initialState(catalog);
  assert.deepEqual(studyModeCounts(catalog, state, filter), { terms: 139, thinking: 620, mixed: 759 });
  for (const extra of [{ groupId: 'routing' }, { direction: 'meaning' }, { preset: 'first100' }, { groupId: 'routing', direction: 'name', preset: 'first100' }]) {
    const conditions = { ...filter, ...extra };
    const counts = studyModeCounts(catalog, state, conditions);
    for (const mode of ['terms', 'thinking', 'mixed']) assert.equal(counts[mode], eligibleCards(catalog, state, { ...conditions, mode }).length);
  }
  state.settings.enabledGroupIds = [];
  assert.deepEqual(studyModeCounts(catalog, state, filter), { terms: 0, thinking: 0, mixed: 0 });
});

test('苦手復習の件数は理解度の変更・非表示に追従し、別カードや予想問題を混ぜない', () => {
  let state = initialState(catalog);
  const terms = eligibleCards(catalog, state, filter);
  const thinking = eligibleCards(catalog, state, { ...filter, mode: 'thinking' });
  const weak = { ...filter, review: 'weak' };
  assert.deepEqual(studyModeCounts(catalog, state, weak), { terms: 0, thinking: 0, mixed: 0 });
  state = recordConfidence(state, terms[0].id, 'unknown');
  state = recordConfidence(state, thinking[0].id, 'unclear');
  state = recordConfidence(state, 'PRED_N001', 'unknown');
  assert.deepEqual(studyModeCounts(catalog, state, weak), { terms: 1, thinking: 1, mixed: 2 });
  state = recordConfidence(state, terms[0].id, 'understood');
  assert.deepEqual(studyModeCounts(catalog, state, weak), { terms: 0, thinking: 1, mixed: 1 });
  state.questionStates[thinking[0].id].hidden = true;
  assert.deepEqual(studyModeCounts(catalog, state, weak), { terms: 0, thinking: 0, mixed: 0 });
});

test('予想問題の種類別件数も非表示・苦手復習に追従する', () => {
  let state = initialState(catalog);
  assert.deepEqual(predictionScopeCounts(catalog, state), { all: 78, short: 72, composite: 6 });
  state = recordConfidence(state, 'PRED_N001', 'unknown');
  state = recordConfidence(state, 'PRED_EX01', 'unclear');
  assert.deepEqual(predictionScopeCounts(catalog, state, { review: 'weak' }), { all: 2, short: 1, composite: 1 });
  state.questionStates.PRED_N001.hidden = true;
  assert.deepEqual(predictionScopeCounts(catalog, state, { review: 'weak' }), { all: 1, short: 0, composite: 1 });
  const counts = predictionScopeCounts(catalog, state);
  for (const scope of ['all', 'short', 'composite']) assert.equal(counts[scope], eligiblePredictionCards(catalog, state, { predictionScope: scope }).length);
});
