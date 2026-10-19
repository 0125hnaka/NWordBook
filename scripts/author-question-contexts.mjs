import { readFile, writeFile } from 'node:fs/promises';
import { validateQuestionContexts } from '../src/question-contexts.js';
import questions from './contexts/questions.mjs';
const atoms = {};
for (let n = 1; n <= 4; n++) {
  const { default: rows } = await import(`./contexts/atoms-${n}.mjs`);
  for (const row of rows.trim().split('\n')) {
    const columns = row.split('|');
    if (columns.length !== 3) throw new Error(`Invalid row: ${row}`);
    const [suffix, context, prompt] = columns, id = `KA_${suffix}`;
    if (Object.hasOwn(atoms, id)) throw new Error(`Duplicate: ${id}`);
    atoms[id] = { context: context.replaceAll('\\n', '\n'), prompt };
  }
}
const questionContexts = { schemaVersion: 1, revision: '2026-10-20-context-v1', atoms, questions };
const read = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
validateQuestionContexts({ questionContexts, atoms: await read('data/source/knowledge_atoms.json'), questions: await read('data/source/question_pool.json') });
await writeFile(new URL('../data/editorial/question_contexts.json', import.meta.url), JSON.stringify(questionContexts, null, 2) + '\n');
console.log(`問題の状況を作成: ${Object.keys(atoms).length}知識・個別の問い${Object.keys(questions).length}問`);
