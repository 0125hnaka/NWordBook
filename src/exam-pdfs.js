export const PDF_CACHE_NAME = 'nwordbook:exam-pdfs:v1';

export function examPdfUrl(doc, base = new URL('../past-exams/', import.meta.url)) {
  if (!/^[a-z0-9_]+\.pdf$/.test(doc.filename) || !/^[a-f0-9]{64}$/.test(doc.sha256)) throw new Error('PDFの出典情報が不正です。');
  const url = new URL(doc.filename, base);
  url.searchParams.set('sha256', doc.sha256);
  return url.href;
}

async function verify(bytes, doc, digest) {
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('PDFの形式を確認できません。');
  const sha = [...new Uint8Array(await digest(bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (sha !== doc.sha256) throw new Error('公式PDFと内容が一致しません。時間をおいて再読み込みしてください。');
}

// CacheStorage stores PDFs only; answers keep their existing independent store.
export function createPdfRepository({ base = new URL('../past-exams/', import.meta.url), fetcher = (...args) => globalThis.fetch(...args), openCache = () => globalThis.caches.open(PDF_CACHE_NAME), digest = bytes => globalThis.crypto.subtle.digest('SHA-256', bytes) } = {}) {
  const pending = new Map();
  async function load(doc) {
    const url = examPdfUrl(doc, base);
    let cache;
    try { cache = await openCache(); } catch { /* Storage may be disabled. Display is still available. */ }
    if (cache) {
      try {
        const saved = await cache.match(url);
        if (saved) {
          const bytes = await saved.arrayBuffer();
          await verify(bytes, doc, digest);
          return { blob: new Blob([bytes], { type: 'application/pdf' }), source: 'saved', persistent: true };
        }
      } catch { try { await cache.delete(url); } catch { /* Retry from the app's own PDF directory. */ } }
    }
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`PDFを読み込めません（HTTP ${response.status}）。通信を確認して「再読み込み」を押してください。`);
    const bytes = await response.arrayBuffer();
    await verify(bytes, doc, digest);
    let persistent = false;
    if (cache) try {
      await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } })); persistent = true;
    } catch { /* Full storage must not prevent solving the question. */ }
    return { blob: new Blob([bytes], { type: 'application/pdf' }), source: 'app', persistent };
  }
  return {
    get(doc) {
      const key = examPdfUrl(doc, base);
      if (!pending.has(key)) pending.set(key, load(doc).finally(() => pending.delete(key)));
      return pending.get(key);
    },
    async count(documents) {
      try {
        const keys = new Set((await (await openCache()).keys()).map(request => request.url));
        return documents.filter(doc => keys.has(examPdfUrl(doc, base))).length;
      } catch { return null; }
    },
  };
}

// One page keeps its aspect ratio; the canvas never exceeds its container.
export function fittedPdfSize(width, height, availableWidth, availableHeight, mode = 'page') {
  const scale = mode === 'width' ? availableWidth / width : Math.min(availableWidth / width, availableHeight / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}
