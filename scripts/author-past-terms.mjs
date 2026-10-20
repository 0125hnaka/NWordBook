import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './data.mjs';
import { compilePastTerms } from './past-term-data.mjs';

const { data, audit } = await compilePastTerms();
for (const [name, value] of [['past_exam_terms', data], ['past_exam_terms_audit', audit]]) await writeFile(join(root, `data/editorial/${name}.json`), JSON.stringify(value, null, 2) + '\n');
const path = join(root, 'data/editorial/question_codes.json');
const codes = JSON.parse(await readFile(path, 'utf8'));
const registered = new Set(Object.values(codes.codes));
let next = Math.max(0, ...Object.keys(codes.codes).filter(c => /^T\d+$/.test(c)).map(c => Number(c.slice(1)))) + 1;
for (const q of data.questions) if (!registered.has(q.id)) { codes.codes[`T${String(next++).padStart(3, '0')}`] = q.id; registered.add(q.id); }
await writeFile(path, JSON.stringify(codes, null, 2) + '\n');
console.log(`過去問の用語クイズ ${data.questions.length}問 / 空欄の採否確認 ${audit.entries.length}件`);
