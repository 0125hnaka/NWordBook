import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root, readJson } from './data.mjs';

export async function verifyExamAssets(catalog = null) {
  catalog ||= await readJson('data/exams/catalog.json');
  const documents = [];
  for (const paper of catalog.papers) for (const doc of paper.documents) {
    if (!/^[a-z0-9_]+\.pdf$/.test(doc.filename)) throw new Error('不正なPDFファイル名です。');
    const bytes = await readFile(join(root, 'past-exams', doc.filename));
    if (bytes.subarray(0, 5).toString() !== '%PDF-' || createHash('sha256').update(bytes).digest('hex') !== doc.sha256) throw new Error(`PDF原本ハッシュ不一致: ${doc.filename}`);
    documents.push({ filename: doc.filename, year: doc.year, session: doc.session, period: doc.period, kind: doc.kind, url: doc.url, sha256: doc.sha256, bytes: bytes.length });
  }
  return { source: catalog.indexUrl, checkedOn: catalog.checkedOn, documents };
}
