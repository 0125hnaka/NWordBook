import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './data.mjs';
import { validateExplanations } from '../src/exam-explanations.js';

// Keep the first published 2025 edition intact, then merge the individually
// authored years. Validate the complete catalog before serving any release.
export async function loadAllExplanations(catalog) {
  const directory = join(root, 'data/exams/explanations');
  const paths = [join(root, 'data/exams/explanations-2025.json'),
    ...(await readdir(directory)).filter(f => /^\d{4}\.json$/.test(f)).sort().map(f => join(directory, f))];
  const editions = await Promise.all(paths.map(async path => validateExplanations(JSON.parse(await readFile(path, 'utf8')), catalog)));
  const data = {
    schemaVersion: 1,
    version: 'all-v1-20261019',
    reviewedOn: '2026-10-19',
    questions: editions.flatMap(e => e.questions),
  };
  return validateExplanations(data, catalog, { complete: true });
}
