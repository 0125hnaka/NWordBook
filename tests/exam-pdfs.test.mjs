import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPdfRepository, examPdfUrl, fittedPdfSize } from '../src/exam-pdfs.js';
import { verifyExamAssets } from '../scripts/exam-assets.mjs';

const bytes = new TextEncoder().encode('%PDF-1.7 test');
const doc = { filename: '2025r07h_nw_pm1_qs.pdf', sha256: createHash('sha256').update(bytes).digest('hex') };
const base = 'https://example.com/NWordBook/past-exams/';
const digest = b => webcrypto.subtle.digest('SHA-256', b);
function memoryCache() {
  const values = new Map();
  return { values, match: async key => values.get(key)?.clone(), put: async (key, value) => { values.set(key, value.clone()); }, delete: async key => values.delete(key), keys: async () => [...values.keys()].map(url => ({ url })) };
}

test('公開する96PDFの内容が全件原本と一致し、公開一覧とも一致する', async () => {
  const result = await verifyExamAssets();
  assert.equal(result.documents.length, 96);
  assert.equal(result.documents.reduce((n, d) => n + d.bytes, 0), 121380136);
  assert.deepEqual(result, JSON.parse(await readFile(new URL('../past-exams/manifest.json', import.meta.url))));
});

test('PDFの取得先はアプリ内の保存フォルダーで、IPAへは取得しに行かない', () => {
  const url = new URL(examPdfUrl(doc, base));
  assert.equal(url.origin, 'https://example.com');
  assert.equal(url.pathname, '/NWordBook/past-exams/2025r07h_nw_pm1_qs.pdf');
  assert.equal(url.searchParams.get('sha256'), doc.sha256);
  assert.throws(() => examPdfUrl({ ...doc, filename: '../private.pdf' }, base));
});

test('初回だけ取得し、ページを開き直した後も端末保存から表示する', async () => {
  const cache = memoryCache(); let requests = 0;
  const options = { base, digest, openCache: async () => cache, fetcher: async () => { requests++; return new Response(bytes); } };
  assert.equal((await createPdfRepository(options).get(doc)).source, 'app');
  const next = createPdfRepository({ ...options, fetcher: () => { throw Error('offline'); } });
  const result = await next.get(doc);
  assert.equal(result.source, 'saved'); assert.equal(result.persistent, true); assert.equal(requests, 1);
  assert.equal(await next.count([doc]), 1);
  assert.equal(await result.blob.text(), '%PDF-1.7 test');
});

test('同じPDFの表示とまとめ保存が重なっても取得を共有する', async () => {
  let requests = 0;
  const repository = createPdfRepository({ base, digest, openCache: async () => memoryCache(), fetcher: async () => { requests++; return new Response(bytes); } });
  const [a, b] = await Promise.all([repository.get(doc), repository.get(doc)]);
  assert.equal(requests, 1); assert.equal(a, b);
});

test('保存済みPDFが破損していたら再取得し、正常な原本に入れ替える', async () => {
  const cache = memoryCache(); cache.values.set(examPdfUrl(doc, base), new Response('%PDF-broken'));
  let requests = 0;
  const repository = createPdfRepository({ base, digest, openCache: async () => cache, fetcher: async () => { requests++; return new Response(bytes); } });
  assert.equal((await repository.get(doc)).source, 'app'); assert.equal(requests, 1);
  assert.equal((await repository.get(doc)).source, 'saved');
});

test('保存容量不足でも表示でき、保存できたとは表示しない', async () => {
  const cache = memoryCache(); cache.put = async () => { throw Error('quota'); };
  const repository = createPdfRepository({ base, digest, openCache: async () => cache, fetcher: async () => new Response(bytes) });
  const result = await repository.get(doc);
  assert.equal(result.persistent, false); assert.equal(await result.blob.text(), '%PDF-1.7 test');
});

test('取得エラーやハッシュ不一致を正常なPDFとして保存しない', async () => {
  const cache = memoryCache();
  for (const response of [new Response('missing', { status: 404 }), new Response('%PDF-modified')]) {
    const repository = createPdfRepository({ base, digest, openCache: async () => cache, fetcher: async () => response });
    await assert.rejects(repository.get(doc)); assert.equal(cache.values.size, 0);
  }
});

test('縦長・横長PDFとスマホ幅でもページ全体が枠に収まり、幅表示も横にはみ出さない', () => {
  for (const [w, h] of [[595, 842], [842, 595]]) for (const [availableW, availableH] of [[600, 480], [310, 624], [930, 340]]) {
    const size = fittedPdfSize(w, h, availableW, availableH);
    assert.ok(size.width <= availableW); assert.ok(size.height <= availableH);
    assert.ok(fittedPdfSize(w, h, availableW, availableH, 'width').width <= availableW);
    assert.ok(Math.abs(size.width / size.height - w / h) < 0.01);
  }
});
