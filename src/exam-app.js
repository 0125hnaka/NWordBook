import { validateExamCatalog, periodLabel, examLabel, answerKeys, createExamStore, parseExamAnswers, formatExamAnswers, parseExamSelection, identifyExamPdf, MAX_ANSWER_LENGTH, MAX_EXAM_BACKUP_BYTES } from './exams.js';
import { mountPdfViewer, closePdfViewer } from './pdf-viewer.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const main = document.querySelector('#main');
const kindLabels = { problem: '問題', answer: '公式解答例', commentary: '採点講評' };
let catalog, store, paper, question, selectedKind = 'problem', pendingImport = null;
const localFiles = new Map();
const docFor = kind => paper.documents.find(d => d.kind === kind);
const selectionHash = () => `#${paper.id}-${question.number}`;
let importing = false;

function showMessage(text) { document.querySelector('#exam-message').textContent = text; }
function render() {
  const years = [...new Set(catalog.papers.map(p => p.year))];
  main.innerHTML = `<div class="exam-heading"><div><p class="eyebrow">PAST PAPERS</p><h1>午後試験を解く</h1><p class="field-note">大問をひとつ選び、問題PDFを見ながら回答します。</p></div><a href="#answer-summary" class="button secondary">回答まとめへ ↓</a></div>
  <section class="panel exam-setup" aria-label="問題の選択"><div class="exam-selectors"><label for="exam-year">年度<select id="exam-year">${years.map(y => `<option value="${y}" ${y === paper.year ? 'selected' : ''}>${y}年度 ${catalog.papers.find(p => p.year === y).session}</option>`).join('')}</select></label><label for="exam-period">時間区分<select id="exam-period">${[1, 2].map(p => `<option value="${p}" ${p === paper.period ? 'selected' : ''}>${periodLabel(p)}</option>`).join('')}</select></label><label for="exam-question">大問<select id="exam-question">${paper.questions.map(q => `<option value="${q.number}" ${q.number === question.number ? 'selected' : ''}>問${q.number}</option>`).join('')}</select></label></div>
  <div class="pdf-import"><label class="button secondary file-label">PDFを選ぶ<input id="exam-pdfs" type="file" accept=".pdf,application/pdf" multiple ${importing ? 'disabled' : ''}></label><label class="button quiet file-label">フォルダーをまとめて選ぶ<input id="exam-folder" type="file" webkitdirectory multiple ${importing ? 'disabled' : ''}></label><span id="pdf-count" class="field-note">${localFiles.size}ファイルを選択中</span></div><p class="field-note">PC内の「past-exams-local」のPDFを選んでください。ファイルは端末内だけで読み取り、送信しません。再読み込み後はPDFを選び直してください。</p>
  <details class="exam-help"><summary>保存場所・使い方</summary><p>PC内のNWordBookフォルダーにある「past-exams-local」に、2009〜2019年・2021〜2025年の16回分を保存しています。問題32冊・解答例32冊・採点講評32冊です。年度ごとの午後Ⅰは3大問、午後Ⅱは2大問から選べます。</p><p>スマホで使う場合はPDFをその端末へ移して選択してください。ブラウザーが埋込み表示に対応しない場合は「別タブで開く」でPDFと回答欄を切り替えられます。</p><p>図・表・経路への回答は、機器名や行名を付けて文字で記入してください。字数・選択数などは問題PDFの指示に従ってください。自動採点は行いません。</p><a href="${esc(catalog.indexUrl)}" target="_blank" rel="noopener noreferrer">IPA公式の過去問題一覧 ↗</a></details></section>
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
  <footer>出典：${esc(examLabel(paper, question))}（IPA）。問題PDFは原本をそのまま表示し、回答欄は独自に作成しています。<br>PDFはPC・端末内だけで使用します。公式解答例は選択したときだけ表示します。</footer>`;
  renderPdf(); updateAnswers(); renderImport();
  document.title = `${examLabel(paper, question)} | NWordBook`;
}

function renderPdf() {
  const doc = docFor(selectedKind), local = localFiles.get(doc.id);
  const box = document.querySelector('#pdf-view');
  closePdfViewer();
  box.innerHTML = local ? `<p class="pdf-filename">${esc(doc.filename)}</p><a class="pdf-open" href="${esc(local.url)}" target="_blank" rel="noopener">別タブで開く ↗</a><div id="pdf-canvas-view" aria-label="${esc(`${paper.year}年度 ${periodLabel(paper.period)} ${kindLabels[selectedKind]}`)}"></div><p class="field-note">冊子全体を表示しています。PDF内で問${question.number}へ移動してください。</p>` : `<div class="pdf-empty"><span aria-hidden="true">▤</span><h3>${kindLabels[selectedKind]}PDFを選んでください</h3><p>${esc(doc.filename)}</p><p class="field-note">上の「PDFを選ぶ」で保存済みのファイルを指定します。</p></div>`;
  if (local) void mountPdfViewer(document.querySelector('#pdf-canvas-view'), local.file, doc.id);
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
  if (input.id === 'exam-pdfs' || input.id === 'exam-folder') {
    if (importing) return;
    const files = [...input.files].filter(f => /\.pdf$/i.test(f.name));
    if (files.length > 96) { showMessage('PDFは96ファイル以下ずつ選択してください。'); input.value = ''; return; }
    importing = true;
    document.querySelectorAll('#exam-pdfs, #exam-folder').forEach(el => { el.disabled = true; });
    let added = 0; const failures = [];
    for (const file of files) {
      showMessage(`端末内のPDFを確認しています… ${added + failures.length + 1} / ${files.length}`);
      try {
        const doc = await identifyExamPdf(file, catalog);
        const old = localFiles.get(doc.id); if (old) URL.revokeObjectURL(old.url);
        localFiles.set(doc.id, { file, url: URL.createObjectURL(file) }); added++;
      } catch (error) { failures.push(error.message); }
    }
    importing = false;
    document.querySelectorAll('#exam-pdfs, #exam-folder').forEach(el => { el.disabled = false; });
    input.value = ''; document.querySelector('#pdf-count').textContent = `${localFiles.size}ファイルを選択中`;
    renderPdf(); showMessage(`${added}ファイルを確認しました。${failures.length ? ` ${failures.length}件は読み込めませんでした。${failures.slice(0, 2).join(' ')}` : files.length ? 'PDFは端末内でのみ表示します。' : 'PDFファイルがありませんでした。'}`);
  }
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
