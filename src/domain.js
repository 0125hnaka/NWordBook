/** Pure domain logic; no browser or storage dependency. */
export const STORAGE_KEY = 'nw-afternoon:user-state:v1';
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
export const questionTypes = ['term', 'mechanism', 'case', 'change', 'failure'];
export const classifications = ['K', 'R', 'KR'];

export function validateDataset(data) {
  const { atoms, questions, profile, first100, manifest } = data;
  if (!Array.isArray(atoms) || !Array.isArray(questions) || !Array.isArray(first100) || !record(profile) || !record(manifest)) fail('教材の形式が不正です。');
  if (!Array.isArray(profile.groups) || !Array.isArray(profile.defaultEnabledGroupIds)) fail('学習分野の形式が不正です。');
  const unique = (items, label) => {
    const ids = new Set();
    for (const item of items) {
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail(`${label}のIDが空または重複しています。`);
      ids.add(item.id);
    }
    return ids;
  };
  const atomIds = unique(atoms, '知識');
  unique(questions, '問題');
  const groupIds = unique(profile.groups, '分野');
  const assigned = new Set();
  for (const group of profile.groups) {
    if (!Array.isArray(group.knowledgeAtomIds) || typeof group.label !== 'string') fail('分野設定が不正です。');
    for (const id of group.knowledgeAtomIds) {
      if (!atomIds.has(id) || assigned.has(id)) fail(`分野の知識IDが不明または重複しています: ${id}`);
      assigned.add(id);
    }
  }
  if (assigned.size !== atomIds.size) fail('分野未割当ての知識があります。');
  if (new Set(profile.defaultEnabledGroupIds).size !== profile.defaultEnabledGroupIds.length || profile.defaultEnabledGroupIds.some(id => !groupIds.has(id))) fail('初期分野が不正です。');
  if (![5, 10, 20].includes(profile.defaultQuestionCount) || typeof profile.allowUnverifiedSupplement !== 'boolean') fail('初期学習設定が不正です。');
  if (new Set(first100).size !== first100.length || first100.some(id => !atomIds.has(id))) fail('推奨100の参照が不正です。');
  const validateCommon = (item, label) => {
    if (!['A', 'B', 'C'].includes(item.priority) || !classifications.includes(item.classification) || ![1, 2, 3].includes(item.importance)) fail(`${label}の優先度・分類・重要度が不正です。`);
    if (!Array.isArray(item.sourceRefs) || !item.sourceRefs.length || item.sourceRefs.some(s => !record(s) || typeof s.verified !== 'boolean')) fail(`${label}の出典が不正です。`);
  };
  for (const atom of atoms) {
    validateCommon(atom, atom.id);
    if (typeof atom.verified !== 'boolean') fail('知識の確認状態が不正です。');
  }
  for (const q of questions) {
    validateCommon(q, q.id);
    if (!atomIds.has(q.knowledgeAtomId)) fail(`知識への参照切れ: ${q.id}`);
    if (typeof q.question !== 'string' || !q.question.trim() || typeof q.answer !== 'string' || !q.answer.trim()) fail(`問題または解答が空です: ${q.id}`);
    if (!questionTypes.includes(q.questionType) || ![1, 2, 3].includes(q.difficulty) || (q.level != null && ![1, 2, 3, 4, 5].includes(q.level)) || typeof q.defaultEnabled !== 'boolean') fail(`問題の形式が不正です: ${q.id}`);
  }
  if (typeof manifest.datasetVersion !== 'string') fail('教材の版が不正です。');
  return data;
}

export function createCatalog(data) {
  validateDataset(data);
  const atomMap = new Map(data.atoms.map(a => [a.id, a]));
  const groupMap = new Map(data.profile.groups.flatMap(g => g.knowledgeAtomIds.map(id => [id, g])));
  return {
    ...data,
    first100Set: new Set(data.first100),
    cards: data.questions.map(q => ({ ...q, atom: atomMap.get(q.knowledgeAtomId), group: groupMap.get(q.knowledgeAtomId) })),
  };
}

export function initialState(catalog) {
  return {
    schemaVersion: 1,
    datasetVersion: catalog.manifest.datasetVersion,
    settings: {
      enabledGroupIds: [...catalog.profile.defaultEnabledGroupIds],
      allowUnverifiedSupplement: false,
      questionCount: catalog.profile.defaultQuestionCount,
    },
    questionStates: {},
  };
}

/** Keep unknown IDs: newer/older datasets must not destroy saved preferences. */
export function parseState(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) fail('状態ファイルは2MB以下のJSONにしてください。');
  let value;
  try { value = JSON.parse(text); } catch { fail('状態JSONを読み取れません。'); }
  if (!record(value) || value.schemaVersion !== 1 || typeof value.datasetVersion !== 'string' || value.datasetVersion.length > 200 || !record(value.settings) || !record(value.questionStates)) fail('対応する状態形式ではありません。');
  const s = value.settings;
  if (!Array.isArray(s.enabledGroupIds) || s.enabledGroupIds.length > 1000 || s.enabledGroupIds.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(s.enabledGroupIds).size !== s.enabledGroupIds.length || typeof s.allowUnverifiedSupplement !== 'boolean' || ![5, 10, 20].includes(s.questionCount)) fail('学習設定が不正です。');
  for (const [id, state] of Object.entries(value.questionStates)) {
    if (!id || id.length > 200 || ['__proto__', 'prototype', 'constructor'].includes(id) || !record(state) || typeof state.hidden !== 'boolean') fail('問題の保存状態が不正です。');
  }
  return value;
}

export function importState(current, incoming, allowSupplement = false) {
  return {
    ...current,
    settings: { ...incoming.settings, enabledGroupIds: [...incoming.settings.enabledGroupIds], allowUnverifiedSupplement: allowSupplement && incoming.settings.allowUnverifiedSupplement },
    questionStates: { ...current.questionStates, ...incoming.questionStates },
  };
}

export function isEligible(card, state, filter = { groupId: 'all', preset: 'all' }, first100Set = new Set()) {
  const normal = card.defaultEnabled && card.atom.verified;
  const supplement = !card.defaultEnabled && !card.atom.verified && card.sourceRefs.some(s => !s.verified && s.relationship === 'candidate_without_ipa_exam_mapping');
  return Boolean((normal || (state.settings.allowUnverifiedSupplement && supplement))
    && state.settings.enabledGroupIds.includes(card.group.id)
    && !state.questionStates[card.id]?.hidden
    && (filter.groupId === 'all' || filter.groupId === card.group.id)
    && (filter.preset !== 'first100' || first100Set.has(card.knowledgeAtomId)));
}

export function eligibleCards(catalog, state, filter) {
  return catalog.cards.filter(card => isEligible(card, state, filter, catalog.first100Set));
}

export function selectQuestions(candidates, count, random = Math.random) {
  const pool = [...new Map(candidates.map(card => [card.id, card])).values()];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const selected = [], deferred = [], atoms = new Set();
  for (const card of pool) {
    if (atoms.has(card.knowledgeAtomId)) deferred.push(card);
    else { selected.push(card); atoms.add(card.knowledgeAtomId); }
  }
  // Use distinct atoms first. If short, prefer a different atom from the last card.
  while (selected.length < count && deferred.length) {
    const next = deferred.findIndex(card => card.knowledgeAtomId !== selected.at(-1)?.knowledgeAtomId);
    selected.push(deferred.splice(next < 0 ? 0 : next, 1)[0]);
  }
  return selected.slice(0, Math.max(0, count));
}

export function createSession(cards, filter, requestedCount) {
  return { queue: cards.map(card => card.id), index: 0, completed: 0, hidden: 0, filter: { ...filter }, requestedCount };
}

export function advanceSession(session, action, hiddenIds = new Set()) {
  if (session.index >= session.queue.length) return session;
  const next = { ...session, index: session.index + 1, completed: session.completed + (action === 'next' ? 1 : 0), hidden: session.hidden + (action === 'hide' ? 1 : 0) };
  while (next.index < next.queue.length && hiddenIds.has(next.queue[next.index])) { next.index++; next.hidden++; }
  return next;
}

export function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function sourceLabel(source) {
  if (!source.verified) return 'IPA設問対応未確認';
  const prefix = `${source.year}年 ${source.session} ${source.section} 問${source.questionNo}`;
  if (source.subQuestion) return `${prefix} ${source.subQuestion}`;
  return `${prefix} 本文${source.problemPdfPages?.length ? `・PDF${source.problemPdfPages.join('・')}ページ` : '（設問番号なし）'}`;
}
