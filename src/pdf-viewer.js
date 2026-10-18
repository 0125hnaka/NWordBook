import * as pdfjs from '../vendor/pdfjs-6.4.299/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs-6.4.299/pdf.worker.mjs', import.meta.url).href;
const assets = new URL('../vendor/pdfjs-6.4.299/', import.meta.url).href;
const pagePositions = new Map();
let current = null;

// Render only one page at a time to keep large scanned booklets usable on phones.
export async function mountPdfViewer(container, file, documentId, initialPage = null) {
  if (current) { current.active = false; current.task?.cancel(); current.observer?.disconnect(); await current.loading?.destroy(); }
  const state = { active: true, task: null, loading: null, observer: null, serial: 0 };
  current = state;
  container.innerHTML = `<div class="pdf-paging"><button type="button" class="button quiet" data-pdf="previous" aria-label="PDFの前ページ" disabled>←</button><label>ページ <input data-pdf="page" aria-label="PDFのページ番号" type="number" min="1" value="1" step="1"></label><span data-pdf="total"></span><button type="button" class="button quiet" data-pdf="next" aria-label="PDFの次ページ" disabled>→</button><label class="pdf-zoom-label">表示倍率<select data-pdf="zoom" aria-label="PDFの表示倍率"><option value="1">幅に合わせる</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div><p data-pdf="status" role="status" class="field-note">PDFを端末内で開いています…</p><div class="pdf-canvas-scroll"><canvas role="img" aria-label="問題資料のPDFページ"></canvas></div>`;
  const canvas = container.querySelector('canvas'), scroll = container.querySelector('.pdf-canvas-scroll');
  const status = container.querySelector('[data-pdf=status]'), pageInput = container.querySelector('[data-pdf=page]');
  const previous = container.querySelector('[data-pdf=previous]'), next = container.querySelector('[data-pdf=next]');
  let page = initialPage || pagePositions.get(documentId) || 1, zoom = 1, pdf;
  async function renderPage() {
    const serial = ++state.serial;
    const pending = state.task;
    pending?.cancel();
    try {
      if (!pdf || !state.active) return;
      if (pending) try { await pending.promise; } catch { /* Cancellation is expected during page changes. */ }
      if (!state.active || serial !== state.serial) return;
      page = Math.max(1, Math.min(pdf.numPages, Math.floor(Number(page)) || 1));
      pageInput.value = page; previous.disabled = page <= 1; next.disabled = page >= pdf.numPages;
      pagePositions.set(documentId, page);
      const pdfPage = await pdf.getPage(page);
      if (!state.active || serial !== state.serial) return;
      const scale = Math.max(240, scroll.clientWidth - 18) / pdfPage.getViewport({ scale: 1 }).width * zoom;
      const viewport = pdfPage.getViewport({ scale });
      // Cap pixels for memory use, while keeping the text sharp on a phone.
      const pixelScale = Math.min(window.devicePixelRatio || 1, 2, 2400 / viewport.width);
      canvas.width = Math.round(viewport.width * pixelScale); canvas.height = Math.round(viewport.height * pixelScale);
      canvas.style.width = `${Math.round(viewport.width)}px`; canvas.style.height = `${Math.round(viewport.height)}px`;
      canvas.setAttribute('aria-label', `PDF ${page} / ${pdf.numPages}ページ`);
      state.task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [pixelScale, 0, 0, pixelScale, 0, 0] });
      await state.task.promise;
      if (!state.active || serial !== state.serial) return;
      status.textContent = `${page} / ${pdf.numPages}ページ · PDF内の問番号を確認してください。`;
    } catch (error) {
      if (state.active && error.name !== 'RenderingCancelledException') status.textContent = 'ページを表示できません。「別タブで開く」も利用できます。';
    }
  }
  container.querySelector('[data-pdf=previous]').addEventListener('click', () => { page--; void renderPage(); });
  container.querySelector('[data-pdf=next]').addEventListener('click', () => { page++; void renderPage(); });
  pageInput.addEventListener('change', () => { page = pageInput.value; void renderPage(); });
  pageInput.addEventListener('input', () => { if (pageInput.value && Number.isFinite(Number(pageInput.value))) { page = pageInput.value; void renderPage(); } });
  container.querySelector('[data-pdf=zoom]').addEventListener('change', event => { zoom = Number(event.target.value); void renderPage(); });
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (!state.active) return;
    state.loading = pdfjs.getDocument({ data, cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/', isEvalSupported: false, enableXfa: false });
    pdf = await state.loading.promise;
    if (!state.active) return;
    pageInput.max = pdf.numPages;
    container.querySelector('[data-pdf=total]').textContent = `/ ${pdf.numPages}`;
    await renderPage();
    let lastWidth = scroll.clientWidth;
    state.observer = new ResizeObserver(() => { if (Math.abs(lastWidth - scroll.clientWidth) > 5) { lastWidth = scroll.clientWidth; void renderPage(); } });
    state.observer.observe(scroll);
  } catch {
    if (state.active) status.textContent = 'PDFを開けません。「別タブで開く」をお試しください。';
  }
}

export function closePdfViewer() {
  if (current) { current.active = false; current.task?.cancel(); current.observer?.disconnect(); void current.loading?.destroy(); current = null; }
}
