import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { root } from './data.mjs';

// Source research is read only; the browser gets labels, never answers/hints.
function csv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(value.replace(/\r$/, '')); value = ''; if (c === '\n') { rows.push(row); row = []; } }
    else value += c;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  const keys = rows.shift();
  return rows.filter(r => r.length === keys.length).map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
}
const research = resolve(root, '../nw-afternoon-flashcards/docs/research');
const sourceFiles = ['source_index.csv', 'source_unit_ledger.csv'];
const texts = await Promise.all(sourceFiles.map(f => readFile(join(research, f), 'utf8')));
const [sources, units] = texts.map(csv);
const { parts } = JSON.parse(await readFile(join(root, 'data/exams/answer-parts.json'), 'utf8'));
if (Object.keys(parts).some(id => !units.some(u => u.sourceUnitKey === id))) throw new Error('複合回答欄の設問IDがありません。');
const documents = sources.filter(s => ['problem', 'answer', 'commentary'].includes(s.documentType)).map(s => ({
  id: s.sourceId, year: Number(s.year), session: s.session, period: s.section === '午後I' ? 1 : 2,
  kind: s.documentType, filename: new URL(s.officialUrl).pathname.split('/').at(-1),
  url: s.officialUrl, indexUrl: s.indexUrl, sha256: s.sha256, pages: Number(s.pageCount),
}));
const papers = documents.filter(d => d.kind === 'problem').map(d => ({
  id: `${d.year}-${d.period}`, year: d.year, session: d.session, period: d.period,
  documents: documents.filter(f => f.year === d.year && f.period === d.period),
  questions: [...new Set(units.filter(u => Number(u.year) === d.year && (u.section === '午後I' ? 1 : 2) === d.period).map(u => Number(u.questionNo)))].map(number => ({
    number, fields: units.filter(u => Number(u.year) === d.year && (u.section === '午後I' ? 1 : 2) === d.period && Number(u.questionNo) === number).map(u => ({
      id: u.sourceUnitKey, label: u.subQuestion.replace(':', ' 空欄 '), group: u.subQuestion.match(/^設問\d+/)[0],
      invalid: u.decision === 'excluded_invalid',
      ...(parts[u.sourceUnitKey] ? { parts: parts[u.sourceUnitKey] } : {}),
    })),
  })),
}));
const data = { schemaVersion: 1, checkedOn: '2026-10-18', exam: 'ネットワークスペシャリスト',
  indexUrl: 'https://www.ipa.go.jp/shiken/mondai-kaiotu/index.html',
  source: sourceFiles.map((name, i) => ({ name, sha256: createHash('sha256').update(texts[i]).digest('hex') })), papers };
await mkdir(join(root, 'data/exams'), { recursive: true });
await writeFile(join(root, 'data/exams/catalog.json'), JSON.stringify(data, null, 2) + '\n');
console.log(`${papers.length}冊 / ${papers.reduce((n, p) => n + p.questions.length, 0)}大問 / ${units.length}回答欄 / ${documents.length} PDF`);
