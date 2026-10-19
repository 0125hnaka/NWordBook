import { readFile, writeFile } from 'node:fs/promises';
import { validateDetailedExplanations } from '../src/detailed-explanations.js';
import lessons from './details/lessons.mjs';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8').then(JSON.parse);
const entries = async (files, prefix) => {
  const result = {};
  for (const file of files) {
    const { default: rows } = await import(`./details/${file}.mjs`);
    for (const row of rows.trim().split('\n').filter(Boolean)) {
      const parts = row.split('|');
      if (parts.length !== 3) throw new Error(`Invalid authored row: ${row}`);
      const [suffix, lesson, body] = parts, id = prefix + suffix;
      if (Object.hasOwn(result, id)) throw new Error(`Duplicate: ${id}`);
      result[id] = { lesson, example: body.replaceAll('\\n', '\n') };
    }
  }
  return result;
};
const details = { schemaVersion: 1, revision: '2026-10-19-detailed-v1', lessons,
  atoms: await entries(['atoms-1', 'atoms-2', 'atoms-3', 'atoms-4'], 'KA_'),
  predictions: await entries(['predictions'], 'PRED_') };
validateDetailedExplanations({ details, atoms: await read('data/source/knowledge_atoms.json'), predictions: await read('data/editorial/prediction_questions.json') });
await writeFile(new URL('../data/editorial/detailed_explanations.json', import.meta.url), JSON.stringify(details, null, 2) + '\n');
console.log(`詳しい解説を作成: ${Object.keys(details.atoms).length}知識・${Object.keys(details.predictions).length}予想問題`);
