import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './data.mjs';
import { validateExplanations } from '../src/exam-explanations.js';
const catalog = JSON.parse(await readFile(join(root, 'data/exams/catalog.json'), 'utf8'));
await mkdir(join(root, 'data/exams/explanations'), { recursive: true });
for (const file of (await readdir(join(root, 'scripts/explanations'))).filter(f => /^\d{4}\.mjs$/.test(f))) {
  const year = file.slice(0, 4), { default: questions } = await import(`./explanations/${file}`);
  const expected = catalog.papers.filter(p => p.year === Number(year)).flatMap(p => p.questions);
  if (questions.length !== expected.length) throw new Error(`${year}: 大問数が一致しません。`);
  const data = { schemaVersion: 1, version: `${year}-v1-20261019`, reviewedOn: '2026-10-19', questions };
  validateExplanations(data, catalog);
  await writeFile(join(root, `data/exams/explanations/${year}.json`), JSON.stringify(data, null, 2) + '\n');
  console.log(`${year}: ${questions.length}大問・${questions.reduce((n, q) => n + q.fields.length, 0)}項目`);
}
