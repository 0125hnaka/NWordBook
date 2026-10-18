import { practiceId } from './exam-practice.js';
export const EXPLANATION_TAGS = {
  knowledge: { mark: '知', label: '知識' }, thinking: { mark: '思', label: '思考' },
  pattern: { mark: '定', label: '定石' }, passage: { mark: '本', label: '本文' },
};
export function validateExplanations(data, catalog) {
  if (data?.schemaVersion !== 1 || !data.version || !Array.isArray(data.questions)) throw new Error('解説の形式が不正です。');
  const seen = new Set();
  for (const entry of data.questions) {
    const paper = catalog.papers.find(p => p.questions.some(q => practiceId(p, q) === entry.id));
    const question = paper?.questions.find(q => practiceId(paper, q) === entry.id);
    if (!question || seen.has(entry.id) || !entry.title || !entry.overview) throw new Error('解説の大問IDが不正です。');
    seen.add(entry.id);
    if (!Array.isArray(entry.fields) || entry.fields.length !== question.fields.length || new Set(entry.fields.map(f => f.id)).size !== question.fields.length) throw new Error('解説に不足・重複があります。');
    for (const field of entry.fields) {
      if (!question.fields.some(f => f.id === field.id) || !field.answer || !field.knowledge || !field.pattern || !field.grading || !field.focus?.text || !Array.isArray(field.steps) || field.steps.length < 2 || field.steps.some(s => !s)) throw new Error('設問の解説が不足しています。');
      if (!Array.isArray(field.tags) || !field.tags.length || new Set(field.tags).size !== field.tags.length || field.tags.some(t => !Object.hasOwn(EXPLANATION_TAGS, t))) throw new Error('解説マークが不正です。');
      const pages = paper.documents.find(d => d.kind === 'problem').pages;
      if (!Array.isArray(field.focus.pages) || !field.focus.pages.length || field.focus.pages.some(p => !Number.isInteger(p) || p < 1 || p > pages)) throw new Error('本文の参照ページが不正です。');
    }
    for (const kind of ['problem', 'answer', 'commentary']) if (entry.source?.[kind] !== paper.documents.find(d => d.kind === kind).filename) throw new Error('解説の出典が不正です。');
    if (!Number.isInteger(entry.source.answerPage) || entry.source.answerPage < 1 || entry.source.answerPage > paper.documents.find(d => d.kind === 'answer').pages) throw new Error('解答例の参照ページが不正です。');
  }
  return data;
}
export function explanationFor(data, paper, question) { return data.questions.find(q => q.id === practiceId(paper, question)) || null; }
