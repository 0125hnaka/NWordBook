// Shared formatting only. Answers, reasoning and passage references are authored
// against each original examination, not inferred from the flashcard dataset.
import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('../../data/exams/catalog.json', import.meta.url)));
export function author(year) {
  const questions = [];
  let current, section;
  function q(period, number, title, overview, answerPage = number) {
    const paper = catalog.papers.find(p => p.year === year && p.period === period);
    current = { id: `${year}-${period}-${number}`, title, overview, fields: [], source: {
      ...Object.fromEntries(paper.documents.map(d => [d.kind, d.filename])), answerPage,
    } };
    questions.push(current); section = null;
  }
  function s(knowledge, pattern) { section = { knowledge, pattern }; }
  function a(suffix, answer, reasoning, pages, focus, marks = 'KTB', grading = null) {
    if (!section) throw new Error('Set the section knowledge before its explanations.');
    const steps = reasoning.split('|');
    if (steps.length < 2 || steps.some(step => !step)) throw new Error(`Reasoning missing: ${suffix}`);
    current.fields.push({
      id: `${current.id.replaceAll('-', '/')}/${suffix}`, answer,
      tags: [...marks].map(t => ({ K: 'knowledge', T: 'thinking', P: 'pattern', B: 'passage' })[t]),
      knowledge: section.knowledge, steps, focus: { pages, text: focus }, pattern: section.pattern,
      grading: grading || `確認する要点：${steps.at(-1)} 記述の言い換えは意味で判断し、要点の一部が不足する場合は△の目安です。`,
    });
  }
  return { q, s, a, questions };
}
