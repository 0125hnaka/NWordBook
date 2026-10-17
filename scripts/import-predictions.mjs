import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const plain = text => text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1').replace(/`/g, '').trim();

export function parsePredictionSource(source) {
  const blocks = [];
  let section = '', current;
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (/^## /.test(line)) { section = line.replace(/^## \d+\. /, ''); current = undefined; }
    const heading = line.match(/^### (N\d{3}|演習\d+) (.+)$/);
    if (heading) { current = { code: heading[1], title: heading[2], section, lines: [] }; blocks.push(current); }
    else if (current) current.lines.push(line);
  }
  const questions = blocks.map(block => {
    const body = block.lines.join('\n');
    const field = label => {
      const value = body.split('\n').find(line => line.startsWith(`**${label}：** `))?.slice(label.length + 6).trim();
      if (!value) throw new Error(`${block.code}: ${label}がありません。`);
      return value;
    };
    const composite = block.code.startsWith('演習');
    const related = field(composite ? '関連' : '既存との差分');
    const relatedPredictionCodes = new Set([...related.matchAll(/N\d{3}/g)].map(m => m[0]));
    for (const range of related.matchAll(/N(\d{3})～N(\d{3})/g)) for (let n = Number(range[1]); n <= Number(range[2]); n++) relatedPredictionCodes.add(`N${String(n).padStart(3, '0')}`);
    const evidence = composite ? '' : field('技術根拠');
    const metadata = composite ? null : body.match(/\*\*優先度：([AB])｜関係：([^｜]+)｜型：([a-z]+)\*\*/);
    if (!composite && !metadata) throw new Error(`${block.code}: 分類がありません。`);
    return {
      id: `PRED_${composite ? `EX${block.code.slice(2).padStart(2, '0')}` : block.code}`,
      code: block.code, title: block.title, section: block.section, kind: composite ? 'composite' : 'short',
      priority: composite ? null : metadata[1], relationship: composite ? '複合演習' : metadata[2], questionType: composite ? 'case' : metadata[3],
      question: composite ? `条件：${plain(field('条件'))}\n\n${plain(field('問'))}` : plain(field('問い')),
      answer: plain(field(composite ? '解答の骨子' : '短答')),
      explanation: composite ? '複数の技術を組み合わせて、症状・仮説・観測・対策のつながりを確認する独自演習です。解答の骨子と自己確認を照合してください。' : plain(field('仕組み・判断')),
      caution: plain(field(composite ? '自己確認' : '注意・トリガー')),
      difference: plain(related),
      relatedAtomIds: [...new Set([...related.matchAll(/KA_[A-Z0-9_]+/g)].map(m => m[0]))],
      relatedPredictionCodes: [...relatedPredictionCodes],
      technicalEvidence: plain(evidence),
      technicalSources: [...evidence.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)].map(m => ({ label: m[1], url: m[2] })),
      examMapping: 'unresearched',
    };
  });
  return { schemaVersion: 1, version: 'prediction-20261017-v1', source: { path: 'data/predictions/source.md', originalFolder: '追加調査_2026-10-17', sha256: createHash('sha256').update(source).digest('hex') }, questions };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const source = await readFile(new URL('../data/predictions/source.md', import.meta.url), 'utf8');
  const result = parsePredictionSource(source);
  await writeFile(new URL('../data/editorial/prediction_questions.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(`予想教材の変換: ${result.questions.length}問`);
}
