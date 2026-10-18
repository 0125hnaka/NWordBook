import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { root, readJson } from './data.mjs';

// Deliberately outside the repository and dist: PDFs are private local files.
const destination = resolve(process.argv[2] || join(root, '../past-exams-local'));
if (destination === resolve(root) || destination.startsWith(resolve(root) + '\\') || destination.startsWith(resolve(root) + '/')) throw new Error('PDFの保存先はリポジトリの外側を指定してください。');
const catalog = await readJson('data/exams/catalog.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(destination, { recursive: true });
const documents = catalog.papers.flatMap(p => p.documents);
let done = 0;
const receipts = [];
for (const doc of documents) {
  if (new URL(doc.url).hostname !== 'www.ipa.go.jp') throw new Error('IPA以外の取得先です。');
  const path = join(destination, doc.filename);
  let bytes; try { bytes = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes || hash(bytes) !== doc.sha256) {
    const response = await fetch(doc.url, { signal: AbortSignal.timeout(90000), redirect: 'error' });
    if (!response.ok) throw new Error(`${doc.filename}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== '%PDF-' || hash(bytes) !== doc.sha256) throw new Error(`${doc.filename}: PDFの原本ハッシュが一致しません。既存ファイルは変更しません。`);
    await writeFile(path, bytes);
  }
  receipts.push({ filename: doc.filename, url: doc.url, sha256: hash(bytes), bytes: bytes.length });
  console.log(`${++done}/${documents.length} ${doc.filename}`);
}
await writeFile(join(destination, 'download-receipt.json'), JSON.stringify({ checkedOn: new Date().toISOString(), documents: receipts }, null, 2));
await writeFile(join(destination, 'はじめに.txt'), 'IPA公式サイトから取得したネットワークスペシャリストの午後試験PDFです。\nNWordBookの「午後試験を解く」で、このフォルダー内のPDFを選択してください。\n問題(qs)、解答例(ans)、採点講評(cmnt)を保存しています。PDFは公開リポジトリに含まれません。\n出典・URL・原本ハッシュはdownload-receipt.jsonを参照してください。\n');
console.log(`保存完了: ${destination}`);
