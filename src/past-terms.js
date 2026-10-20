import { examYearLabel, periodLabel } from './exams.js';

export const pastTermSourceLabel = source => `${examYearLabel(source.year)} ${source.session} ${periodLabel(source.period)} 問${source.questionNo} ${source.label}`;
export const pastTermKey = answer => answer.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function createPastTermCards(data) {
  if (data === undefined) return [];
  if (data?.schemaVersion !== 1 || typeof data.version !== 'string' || !Array.isArray(data.questions) || !data.questions.length) throw new Error('過去問の用語教材が不正です。');
  const ids = new Set();
  return data.questions.map(q => {
    const s = q.source;
    if (!s || q.id !== `PAST_TERM_${s.fieldId}` || !/^\d{4}\/[12]\/[123]\//.test(s.fieldId) || ids.has(q.id)
      || ![q.question, q.answer, q.explanation, s.label].every(t => typeof t === 'string' && t.trim()) || !q.question.includes('［　］')
      || !Number.isInteger(s.year) || ![1, 2].includes(s.period) || ![1, 2, 3].includes(s.questionNo)
      || !s.fieldId.startsWith(`${s.year}/${s.period}/${s.questionNo}/`) || !Array.isArray(s.pages) || !s.pages.length || s.pages.some(n => !Number.isInteger(n) || n < 1)
      || !Number.isInteger(s.answerPage) || s.answerPage < 1
      || ![s.problem, s.answer].every(f => typeof f === 'string' && /^[\w-]+\.pdf$/.test(f))) throw new Error(`過去問の用語の形式が不正です: ${q.id}`);
    ids.add(q.id);
    return { ...q, pastTerm: true, questionType: 'term', termDirection: 'name', knowledgeAtomId: `past-term:${pastTermKey(q.answer)}`,
      group: { id: 'past-terms', label: '過去問の用語' }, atom: { verified: true },
      answerFocus: '［　］に入る語だけを答えてください。空欄の外にある「ID」「キャスト」などは含めません。',
    };
  });
}

export function eligiblePastTermCards(catalog, state, filter = {}) {
  return catalog.pastTermCards.filter(c => !state.questionStates[c.id]?.hidden
    && (!filter.pastTermYear || filter.pastTermYear === 'all' || c.source.year === Number(filter.pastTermYear))
    && (!filter.pastTermPeriod || filter.pastTermPeriod === 'all' || c.source.period === Number(filter.pastTermPeriod))
    && (filter.review !== 'weak' || ['unclear', 'unknown'].includes(state.questionStates[c.id]?.confidence)));
}

/** Counts are limited to this curated collection, not all occurrences in IPA exams. */
export function pastTermOccurrences(catalog, card) {
  const cards = catalog.pastTermCards.filter(c => c.knowledgeAtomId === card.knowledgeAtomId);
  return { cards, paperCount: new Set(cards.map(c => `${c.source.year}-${c.source.period}`)).size };
}
