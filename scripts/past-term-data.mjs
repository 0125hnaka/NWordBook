import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root } from './data.mjs';
import { loadAllExplanations } from './explanation-data.mjs';
import { validateExamCatalog } from '../src/exams.js';

export async function compilePastTerms() {
  const catalogText = await readFile(join(root, 'data/exams/catalog.json'), 'utf8');
  const catalog = validateExamCatalog(JSON.parse(catalogText));
  const explanations = await loadAllExplanations(catalog);
  const authored = new Map();
  for (const file of (await readdir(join(root, 'scripts/past-terms'))).filter(f => /^\d{4}\.mjs$/.test(f)).sort()) {
    for (const [id, stem] of Object.entries((await import(`./past-terms/${file}`)).default)) {
      if (authored.has(id)) throw new Error(`用語の編集重複: ${id}`);
      authored.set(id, stem);
    }
  }
  const excluded = JSON.parse(await readFile(join(root, 'data/editorial/past_exam_terms_excluded.json'), 'utf8'));
  const excludedIds = new Set(excluded.ids);
  if (excludedIds.size !== excluded.ids.length) throw new Error('用語の除外IDが重複しています。');
  const details = new Map(explanations.questions.flatMap(q => q.fields.map(f => [f.id, { ...f, source: q.source }])));
  const entries = [], questions = [], seen = new Set();
  for (const paper of catalog.papers) for (const question of paper.questions) for (const field of question.fields.filter(f => f.label.includes('空欄'))) {
    seen.add(field.id);
    const detail = details.get(field.id), stem = authored.get(field.id);
    if ((!stem) === (!excludedIds.has(field.id))) throw new Error(`用語の採否を明示してください: ${field.id}`);
    entries.push({ sourceFieldId: field.id, status: stem ? 'included' : 'excluded', answer: detail.answer });
    if (!stem) continue;
    if (field.invalid || field.parts || !stem.includes('［　］') || stem.length > 230) throw new Error(`独立した空欄用語ではありません: ${field.id}`);
    const problem = paper.documents.find(d => d.kind === 'problem');
    const answer = paper.documents.find(d => d.kind === 'answer');
    questions.push({
      id: `PAST_TERM_${field.id}`, question: stem, answer: detail.answer,
      explanation: detail.knowledge,
      source: { fieldId: field.id, label: field.label, year: paper.year, session: paper.session, period: paper.period,
        questionNo: question.number, pages: detail.focus.pages, problem: problem.filename, answer: answer.filename,
        answerPage: detail.source.answerPage, officialProblemUrl: problem.url, officialAnswerUrl: answer.url },
    });
  }
  for (const id of [...authored.keys(), ...excludedIds]) if (!seen.has(id)) throw new Error(`原問にない用語ID: ${id}`);
  const sourceHash = createHash('sha256').update(catalogText).update(JSON.stringify(explanations)).digest('hex');
  return {
    data: { schemaVersion: 1, version: '20261020-v1', questions },
    audit: { schemaVersion: 1, reviewedOn: '2026-10-20', sourceHash, reviewedPapers: catalog.papers.map(p => p.id),
      policy: '本文の空欄前後を短く整理した独自編集問題。図表の転記、固有構成・値、計算、一般語や長文記述に依存する空欄は不採用。解答は元の解答例と照合済みの解説データをそのまま使用。',
      entries },
  };
}

export async function verifyPastTerms(data) {
  const expected = await compilePastTerms();
  const audit = JSON.parse(await readFile(join(root, 'data/editorial/past_exam_terms_audit.json'), 'utf8'));
  if (JSON.stringify(data) !== JSON.stringify(expected.data) || JSON.stringify(audit) !== JSON.stringify(expected.audit)) throw new Error('用語クイズの教材・採否台帳が原問または編集元と一致しません。node scripts/author-past-terms.mjs で再生成してください。');
  return expected;
}
