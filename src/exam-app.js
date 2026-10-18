import { validateExamCatalog, periodLabel, examLabel, answerKeys, createExamStore, parseExamAnswers, formatExamAnswers, parseExamSelection, MAX_ANSWER_LENGTH, MAX_EXAM_BACKUP_BYTES } from './exams.js';
import { mountPdfViewer, closePdfViewer } from './pdf-viewer.js';
import { createPdfRepository, examPdfUrl } from './exam-pdfs.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const main = document.querySelector('#main');
const kindLabels = { problem: '問題', answer: '公式解答例', commentary: '採点講評' };
let catalog, store, paper, question, selectedKind = 'problem', pendingImport = null;
const pdfRepository = createPdfRepository();
let pdfRequest = 0, activeBlobUrl = null, savingAll = false, stopSaving = false, cacheMessage = '';
const docFor = kind => paper.documents.find(d => d.kind === kind);
const selectionHash = () => `#${paper.id}-${question.number}`;

function showMessage(text) { document.querySelector('#exam-message').textContent = text; }
function render() {
  const years = [...new Set(catalog.papers.map(p => p.year))];
  main.innerHTML = `<div class="exam-heading"><div><p class="eyebrow">PAST PAPERS</p><h1>午後試験を解く</h1><p class="field-note">大問をひとつ選び、問題PDFを見ながら回答します。</p></div><a href="#answer-summary" class="button secondary">回答まとめへ ↓</a></div>
  <section class="panel exam-setup" aria-label="問題の選択"><div class="exam-selectors"><label for="exam-year">年度<select id="exam-year">${years.map(y => `<option value="${y}" ${y === paper.year ? 'selected' : ''}>${y}年度 ${catalog.papers.find(p => p.year === y).session}</option>`).join('')}</select></label><label for="exam-period">時間区分<select id="exam-period">${[1, 2].map(p => `<option value="${p}" ${p === paper.period ? 'selected' : ''}>${periodLabel(p)}</option>`).join('')}</select></label><label for="exam-question">大問<select id="exam-question">${paper.questions.map(q => `<option value="${q.number}" ${q.number === question.number ? 'selected' : ''}>問${q.number}</option>`).join('')}</select></label></div>
  <p class="field-note pdf-auto-note">選んだ年度のPDFを自動で開きます。保存済みのPDFは、この端末から読み込みます。</p>
  <details class="exam-help"><summary>PDFの保存・使い方</summary><p>2009〜2019年・2021〜2025年の16回分（問題32冊・解答例32冊・採点講評32冊）をアプリに保存しています。初回はアプリの配信先から取得し、以後はブラウザー内の保存を優先します。IPAへ表示の都度取得しに行くことはありません。</p><div class="pdf-download-actions"><button id="save-all-pdfs" class="button secondary" ${savingAll ? 'disabled' : ''}>すべてのPDFをこの端末に保存（約122MB）</button><button id="stop-save-pdfs" class="button quiet" ${savingAll ? '' : 'hidden'}>保存を中断</button></div><p id="cache-progress" role="status">${esc(cacheMessage)}</p><p><a href="https://github.com/0125hnaka/NWordBook/tree/main/past-exams" target="_blank" rel="noopener noreferrer">公開PDFフォルダー ↗</a> · <a href="https://github.com/0125hnaka/NWordBook/archive/refs/heads/main.zip">PDFを含む一式をダウンロード</a></p><p>iPhone・iPadでも同じページから利用できます。Safariは「ファイル」アプリ内のフォルダーを自動では読めないため、ブラウザー内の保存を利用します。ブラウザーデータの削除・空き容量によって保存が消えた場合は、再取得します。</p><p>図・表・経路への回答は、機器名や行名を付けて文字で記入してください。字数・選択数などは問題PDFの指示に従ってください。自動採点は行いません。</p><a href="${esc(catalog.indexUrl)}" target="_blank" rel="noopener noreferrer">IPA公式の過去問題一覧 ↗</a></details></section>
  <p id="exam-message" role="status" aria-live="polite"></p>
  <div class="exam-workspace"><section class="panel pdf-panel" aria-label="問題資料"><div class="pdf-toolbar"><h2>資料</h2><label for="pdf-kind" class="sr-only">表示する資料</label><select id="pdf-kind">${Object.entries(kindLabels).map(([kind, label]) => `<option value="${kind}" ${selectedKind === kind ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div id="pdf-view"></div></section>
  <section class="panel exam-answer-panel" aria-label="回答欄"><div class="section-title"><h2>${periodLabel(paper.period)} 問${question.number}</h2><span id="answer-progress" class="field-note"></span></div><p class="field-note">${paper.year}年度 ${esc(paper.session)} · <span id="save-status" role="status"></span></p><p id="save-warning" class="notice warning" ${store.notice ? '' : 'hidden'}>${esc(store.notice)}</p>
  ${[...new Set(question.fields.map(f => f.group))].map(group => `<fieldset class="exam-fieldset"><legend>${esc(group)}</legend>${question.fields.filter(f => f.group === group).map((field, index) => {
    const parts = field.parts?.length ? field.parts.map((label, i) => ({ label, key: `${field.id}#${i + 1}` })) : [{ label: '', key: field.id }];
    return `<div class="answer-unit">${field.invalid ? '<p class="invalid-question">IPAが設問の不備を公表しています。参考用の回答欄です。</p>' : ''}${parts.map((part, i) => {
      const id = `answer-${group.slice(2)}-${index}-${i}`;
      return `<label for="${id}">${esc(field.label.replace(group, '').trim() || group)}${part.label ? `［${esc(part.label)}］` : ''}</label><textarea id="${id}" data-answer-key="${esc(part.key)}" rows="${field.label.includes('空欄') ? 1 : 3}" maxlength="${MAX_ANSWER_LENGTH}" spellcheck="false" aria-describedby="${id}-length">${esc(store.answers[part.key] || '')}</textarea><span id="${id}-length" class="answer-length">${[...(store.answers[part.key] || '')].length}字</span>`;
    }).join('')}</div>`;
  }).join('')}</fieldset>`).join('')}
  </section></div>
  <section class="panel answer-summary" id="answer-summary"><div class="section-title"><h2>自分の回答まとめ</h2><button id="copy-answers" class="button primary">回答をコピー</button></div><p class="field-note">現在の大問の全回答です。設問番号を含めてコピーできます。</p><label class="sr-only" for="answers-text">設問番号付きの回答まとめ</label><textarea id="answers-text" readonly rows="14"></textarea><p id="copy-status" role="status" aria-live="polite"></p><div class="backup-actions"><button id="backup-answers" class="button secondary">全年度の回答をバックアップ</button><label class="button quiet file-label">回答バックアップを読み込む<input id="restore-answers" type="file" accept=".json,application/json"></label></div><p class="field-note">回答はこのブラウザーへ自動保存します。別端末への移行やブラウザーデータ削除に備えて、バックアップを保存してください。PDFは含みません。</p><div id="import-preview"></div></section>
  <footer>出典：${esc(examLabel(paper, question))}（IPA）。問題PDFは原本をそのまま表示し、回答欄は独自に作成しています。<br>公式解答例は選択したときだけ表示します。</footer>`;
  renderPdf(); updateAnswers(); renderImport();
  document.title = `${examLabel(paper, question)} | NWordBook`;
}

async function renderPdf() {
  const doc = docFor(selectedKind), request = ++pdfRequest;
  const box = document.querySelector('#pdf-view');
  closePdfViewer();
  if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null;
  box.innerHTML = `<p class="pdf-filename">${esc(doc.filename)}</p><p class="field-note" role="status">PDFを読み込んでいます…</p>`;
  try {
    const result = await pdfRepository.get(doc);
    if (request !== pdfRequest) return;
    activeBlobUrl = URL.createObjectURL(result.blob);
    const status = result.source === 'saved' ? 'この端末に保存したPDFを表示しています。' : result.persistent ? 'PDFを読み込み、この端末にも保存しました。' : 'PDFを表示しています。端末内への保存が使えないため、次回も通信が必要です。';
    box.innerHTML = `<p class="pdf-filename">${esc(doc.filename)}</p><div class="pdf-links"><a href="${esc(activeBlobUrl)}" target="_blank" rel="noopener">別タブで開く ↗</a><a href="${esc(activeBlobUrl)}" download="${esc(doc.filename)}">このPDFをダウンロード</a></div><p class="field-note" role="status">${status}</p><div id="pdf-canvas-view" aria-label="${esc(`${paper.year}年度 ${periodLabel(paper.period)} ${kindLabels[selectedKind]}`)}"></div><p class="field-note">冊子全体を表示しています。ページ番号で問${question.number}へ移動してください。</p>`;
    void mountPdfViewer(document.querySelector('#pdf-canvas-view'), result.blob, doc.id);
    void updateCacheCount();
  } catch (error) {
    if (request !== pdfRequest) return;
    box.innerHTML = `<div class="pdf-empty"><h3>PDFを読み込めませんでした</h3><p role="status">${esc(error.message)}</p><button id="retry-pdf" class="button secondary">再読み込み</button><a href="${esc(examPdfUrl(doc))}" target="_blank" rel="noopener">PDFを直接開く ↗</a></div>`;
  }
}

async function updateCacheCount() {
  if (savingAll) return;
  const count = await pdfRepository.count(catalog.papers.flatMap(p => p.documents));
  if (savingAll) return;
  cacheMessage = count === null ? 'このブラウザーではPDFの端末保存が使えません。' : `${count} / 96ファイルをこの端末に保存済み`;
  const status = document.querySelector('#cache-progress'); if (status) status.textContent = cacheMessage;
}

async function saveAllPdfs() {
  if (savingAll) return;
  savingAll = true; stopSaving = false;
  const update = text => {
    cacheMessage = text;
    document.querySelector('#cache-progress').textContent = text;
    document.querySelector('#save-all-pdfs').disabled = savingAll;
    document.querySelector('#stop-save-pdfs').hidden = !savingAll;
  };
  let saved = 0;
  try {
    const documents = catalog.papers.flatMap(p => p.documents);
    for (const doc of documents) {
      if (stopSaving) break;
      update(`${saved} / ${documents.length}ファイルを確認・保存中…`);
      const result = await pdfRepository.get(doc);
      if (!result.persistent) throw new Error('端末に保存できませんでした。空き容量やブラウザーの保存設定を確認してください。');
      saved++;
    }
    savingAll = false; update(stopSaving ? `保存を中断しました。今回確認した${saved}ファイルは保持しています。` : '96ファイルすべてをこの端末に保存しました。');
  } catch (error) { savingAll = false; update(`保存を停止しました。${error.message} 保存済みのPDFは保持しています。`); }
}

function updateAnswers() {
  document.querySelector('#answers-text').value = formatExamAnswers(paper, question, store.answers);
  const keys = answerKeys(question);
  document.querySelector('#answer-progress').textContent = `${keys.filter(k => store.answers[k]?.trim()).length} / ${keys.length}欄を記入`;
  document.querySelector('#save-status').textContent = store.persistent ? 'このブラウザーに自動保存' : '一時保存（バックアップ推奨）';
  const warning = document.querySelector('#save-warning'); warning.textContent = store.notice; warning.hidden = !store.notice;
}

function renderImport() {
  document.querySelector('#import-preview').innerHTML = pendingImport ? `<div class="notice"><p>${Object.keys(pendingImport.answers).length}欄の回答を確認しました。同じ設問の回答はバックアップの内容で置き換えます。</p><button id="apply-answers" class="button secondary">回答を読み込む</button> <button id="cancel-answers" class="button quiet">取り消す</button></div>` : '';
}

function select(nextPaper, nextQuestion) {
  paper = nextPaper; question = nextQuestion; selectedKind = 'problem';
  history.replaceState(null, '', selectionHash()); render();
}

main.addEventListener('input', event => {
  const input = event.target;
  if (!input.dataset.answerKey) return;
  store.set(input.dataset.answerKey, input.value);
  document.getElementById(`${input.id}-length`).textContent = `${[...input.value].length}字`;
  document.querySelector('#copy-status').textContent = '';
  updateAnswers();
});

main.addEventListener('change', async event => {
  const input = event.target;
  if (input.id === 'exam-year') { const next = catalog.papers.find(p => p.year === Number(input.value) && p.period === paper.period); select(next, next.questions[question.number - 1] || next.questions[0]); }
  if (input.id === 'exam-period') { const next = catalog.papers.find(p => p.year === paper.year && p.period === Number(input.value)); select(next, next.questions[question.number - 1] || next.questions[0]); }
  if (input.id === 'exam-question') select(paper, paper.questions[Number(input.value) - 1]);
  if (input.id === 'pdf-kind') { selectedKind = input.value; renderPdf(); }
  if (input.id === 'restore-answers') {
    try {
      const file = input.files[0]; if (!file) return;
      if (file.size > MAX_EXAM_BACKUP_BYTES) throw new Error('回答ファイルは5MB以下にしてください。');
      pendingImport = parseExamAnswers(await file.text(), catalog); renderImport();
    } catch (error) { pendingImport = null; renderImport(); showMessage(error.message); }
    input.value = '';
  }
});

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

main.addEventListener('click', async event => {
  if (event.target.closest('a[href="#answer-summary"]')) {
    event.preventDefault(); document.querySelector('#answer-summary').scrollIntoView({ behavior: 'smooth' }); return;
  }
  const id = event.target.closest('button')?.id;
  if (id === 'retry-pdf') void renderPdf();
  if (id === 'save-all-pdfs') void saveAllPdfs();
  if (id === 'stop-save-pdfs') { stopSaving = true; document.querySelector('#cache-progress').textContent = '現在のPDFの保存が終わったら中断します。'; }
  if (id === 'copy-answers') {
    const text = document.querySelector('#answers-text').value;
    try { await navigator.clipboard.writeText(text); document.querySelector('#copy-status').textContent = 'この大問の回答をコピーしました。'; }
    catch { const output = document.querySelector('#answers-text'); output.focus(); output.select(); document.querySelector('#copy-status').textContent = '自動コピーが使えません。選択された回答をコピーしてください。'; }
  }
  if (id === 'backup-answers') download(store.export(), `nwordbook-exam-answers-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  if (id === 'apply-answers' && pendingImport) { store.merge(pendingImport); pendingImport = null; render(); showMessage('回答バックアップを読み込みました。'); }
  if (id === 'cancel-answers') { pendingImport = null; renderImport(); }
});

window.addEventListener('hashchange', () => { if (!/^#\d{4}-[12]-[123]$/.test(location.hash) || !catalog) return; ({ paper, question } = parseExamSelection(location.hash, catalog)); selectedKind = 'problem'; render(); });
window.addEventListener('beforeunload', event => { if (store && !store.persistent && Object.keys(store.answers).length) { event.preventDefault(); event.returnValue = ''; } });

try {
  const response = await fetch(new URL('../study-data/exams.json', import.meta.url));
  if (!response.ok) throw new Error(`教材を取得できません（HTTP ${response.status}）。`);
  catalog = validateExamCatalog(await response.json()); store = createExamStore(catalog);
  ({ paper, question } = parseExamSelection(location.hash, catalog));
  history.replaceState(null, '', selectionHash()); render();
} catch (error) { main.innerHTML = `<h1>午後試験を読み込めませんでした</h1><p>${esc(error.message)}</p><a href="./exam.html">再読み込みする</a>`; }
