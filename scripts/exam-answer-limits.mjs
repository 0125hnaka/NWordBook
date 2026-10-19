import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './data.mjs';
import { answerKeys, validateExamCatalog } from '../src/exams.js';

// Editorial annotations are separate from the immutable saved-answer IDs.
export function applyExamAnswerLimits(catalog, data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.reviewedPapers) || data.reviewedPapers.length !== catalog.papers.length || new Set(data.reviewedPapers).size !== catalog.papers.length || !data.limits || !data.sources) throw new Error('文字数制限の確認範囲が不正です。');
  const fields = new Map();
  for (const paper of catalog.papers) {
    const doc = paper.documents.find(d => d.kind === 'problem'), source = data.sources[paper.id];
    if (!data.reviewedPapers.includes(paper.id) || source?.filename !== doc.filename || source.sha256 !== doc.sha256) throw new Error('文字数制限の原本が一致しません。');
    for (const question of paper.questions) for (const field of question.fields) fields.set(field.id, { field, doc });
  }
  const answerLimits = {};
  for (const [id, record] of Object.entries(data.limits)) {
    const found = fields.get(id);
    if (!found || !Number.isInteger(record.page) || record.page < 1 || record.page > found.doc.pages) throw new Error(`文字数制限の出典が不正です: ${id}`);
    const keys = answerKeys({ fields: [found.field] });
    if (!Array.isArray(record.max) || record.max.length !== keys.length || (record.notes && (!Array.isArray(record.notes) || record.notes.length !== keys.length))) throw new Error(`文字数制限と回答欄の数が一致しません: ${id}`);
    keys.forEach((key, i) => {
      if (record.max[i] !== null || record.notes?.[i]) answerLimits[key] = { max: record.max[i], ...(record.notes?.[i] ? { note: record.notes[i] } : {}) };
    });
  }
  return validateExamCatalog({ ...catalog, answerLimits });
}

export async function loadExamAnswerLimits(catalog) {
  return applyExamAnswerLimits(catalog, JSON.parse(await readFile(join(root, 'data/exams/answer-limits.json'), 'utf8')));
}
