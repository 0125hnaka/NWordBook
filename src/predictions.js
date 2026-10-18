const text = value => typeof value === 'string' && value.trim().length > 0;

export function validatePredictions(data, atomIds = new Set()) {
  if (data === undefined) return;
  if (data.schemaVersion !== 1 || !text(data.version) || !Array.isArray(data.questions) || !data.questions.length || !data.source || !/^[a-f0-9]{64}$/.test(data.source.sha256)) throw new Error('予想教材の形式が不正です。');
  const ids = new Set(), codes = new Set(data.questions.map(q => q.code));
  for (const q of data.questions) {
    if (!/^PRED_(N\d{3}|EX\d{2})$/.test(q.id) || ids.has(q.id) || !text(q.code) || !['short', 'composite'].includes(q.kind) || q.examMapping !== 'unresearched' || (q.kind === 'short' ? !['A', 'B'].includes(q.priority) : q.priority !== null) || !['mechanism', 'case', 'change', 'failure'].includes(q.questionType)) throw new Error('予想問題のID・分類が不正です。');
    ids.add(q.id);
    for (const key of ['title', 'section', 'question', 'answer', 'explanation', 'caution', 'difference']) if (!text(q[key])) throw new Error(`予想問題 ${q.id} の ${key} が空です。`);
    if (!Array.isArray(q.relatedAtomIds) || q.relatedAtomIds.some(id => !atomIds.has(id)) || !Array.isArray(q.relatedPredictionCodes) || q.relatedPredictionCodes.some(code => !codes.has(code))) throw new Error('予想問題の関連参照が不正です。');
    if (!Array.isArray(q.technicalSources) || (q.kind === 'short' && (!q.technicalSources.length || !text(q.technicalEvidence))) || q.technicalSources.some(s => { try { return !text(s.label) || new URL(s.url).protocol !== 'https:'; } catch { return true; } })) throw new Error('予想問題の技術根拠が不正です。');
  }
  if (codes.size !== data.questions.length) throw new Error('予想問題の資料IDが重複しています。');
}

export function createPredictionCards(data, normalize) {
  return (data?.questions || []).map(q => {
    const fields = Object.fromEntries(['title', 'question', 'answer', 'explanation', 'caution', 'difference'].map(key => [key, normalize(q[key])]));
    return {
      ...q, ...fields, prediction: true, knowledgeAtomId: `PRED_ATOM_${q.code}`,
      group: { id: `prediction:${q.section}`, label: normalize(q.section) },
      answerFocus: '問いに指定された判断・理由・確認対象を、条件に沿って答えてください。',
      thinkingTrigger: fields.caution, importance: q.priority === 'A' ? 3 : 2, classification: 'KR', difficulty: q.kind === 'composite' ? 3 : 2,
      sourceRefs: [],
      atom: { verified: false, commonTrap: fields.caution, thinkingTrigger: fields.caution },
    };
  });
}

export function eligiblePredictionCards(catalog, state, filter = {}) {
  return (catalog.predictionCards || []).filter(c => !state.questionStates[c.id]?.hidden
    && (!filter.predictionScope || filter.predictionScope === 'all' || c.kind === filter.predictionScope)
    && (filter.review !== 'weak' || ['unclear', 'unknown'].includes(state.questionStates[c.id]?.confidence)));
}

export function predictionScopeCounts(catalog, state, filter = {}) {
  return Object.fromEntries(['all', 'short', 'composite'].map(predictionScope => [predictionScope, eligiblePredictionCards(catalog, state, { ...filter, predictionScope }).length]));
}
