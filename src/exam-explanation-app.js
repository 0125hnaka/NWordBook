import { validateExamCatalog, parseExamSelection, examLabel, createExamStore, answerKeys } from './exams.js';
import { createPracticeStore, exportExamBackup } from './exam-practice.js';
import { validateExplanations, explanationFor, EXPLANATION_TAGS } from './exam-explanations.js';
import { updateGradeBoxes, scoreText, escapeHtml as esc } from './exam-grade-ui.js';
import { examPdfUrl } from './exam-pdfs.js';

const main = document.querySelector('#main');
let catalog, data, paper, question, answers, practice;
function renderGrades() {
  document.querySelector('#explanation-score').textContent = scoreText(question, answers.answers, practice.state.marks);
  updateGradeBoxes(main, question, answers.answers, practice.state.marks);
  const warning = document.querySelector('#explanation-warning');
  warning.innerHTML = practice.notice ? `${esc(practice.notice)} <button id="backup-explanation" class="button secondary">回答・採点・時間をバックアップ</button>` : ''; warning.hidden = !practice.notice;
}
function render() {
  const entry = explanationFor(data, paper, question);
  const backUrl = `./exam.html#${paper.id}-${question.number}`;
  document.querySelector('#back-to-exam').href = backUrl;
  document.title = `${examLabel(paper, question)}の解説 | NWordBook`;
  if (!entry) { main.innerHTML = `<h1>この大問の解説は準備中です</h1><p>2025年度の5大問を公開しています。</p><a class="button secondary" href="${backUrl}">回答画面へ戻る</a>`; return; }
  const problemUrl = examPdfUrl(paper.documents.find(d => d.kind === 'problem'));
  const answerUrl = examPdfUrl(paper.documents.find(d => d.kind === 'answer'));
  main.innerHTML = `<div class="exam-heading"><div><p class="eyebrow">EXPLANATION</p><h1>${esc(entry.title)}</h1><p>${esc(examLabel(paper, question))}</p></div><a class="button secondary" href="${backUrl}">回答画面へ戻る</a></div>
  <section class="panel explanation-intro"><p>${esc(entry.overview)}</p><p class="field-note">公式問題・解答例を参照した独自解説です。記述は意味と必要な要素を照合し、○△×を選んでください。公式の採点基準ではありません。</p><div class="explanation-legend">${Object.entries(EXPLANATION_TAGS).map(([tag, item]) => `<span class="explanation-tag tag-${tag}">${item.mark} ${item.label}</span>`).join('')}</div><p class="field-note">設問のマークは、解くときに特に使う力です。下の各欄で知識・道筋・定石・本文を確認できます。</p><p id="explanation-score" role="status"></p><p class="field-note">100点換算の目安：項目を均等配点、○100%・△50%・×0%。未採点は暫定0点です。</p><p id="explanation-warning" class="notice warning" hidden></p><a href="${esc(answerUrl)}#page=${entry.source.answerPage}" target="_blank" rel="noopener">公式解答例（PDF ${entry.source.answerPage}ページ）↗</a><p class="field-note">${entry.fields.length}項目 · 回答と自己採点は回答画面と共通です。バックアップは回答画面から保存できます。</p><nav class="explanation-jumps" aria-label="設問へ移動">${[...new Set(question.fields.map(f => f.group))].map((group, i) => `<a href="#explanation-group-${i}" data-jump="explanation-group-${i}">${esc(group)}</a>`).join('')}</nav></section>
  ${question.fields.map((field, i) => {
    const detail = entry.fields.find(f => f.id === field.id);
    const groupStart = i === 0 || question.fields[i - 1].group !== field.group;
    const groupIndex = [...new Set(question.fields.map(f => f.group))].indexOf(field.group);
    const own = answerKeys({ fields: [field] }).map((key, part) => `${field.parts?.[part] ? `［${field.parts[part]}］` : ''}${answers.answers[key]?.trim() || '未回答'}`).join('\n');
    return `${groupStart ? `<h2 id="explanation-group-${groupIndex}" class="explanation-group">${esc(field.group)}</h2>` : ''}<article class="panel explanation-card"><div class="section-title"><h3>${esc(field.label)}</h3><div class="explanation-tags">${detail.tags.map(tag => `<span class="explanation-tag tag-${tag}" title="${EXPLANATION_TAGS[tag].label}">${EXPLANATION_TAGS[tag].mark}<span class="sr-only">：${EXPLANATION_TAGS[tag].label}</span></span>`).join('')}</div></div><div class="explanation-answer"><h4>解答例</h4><p>${esc(detail.answer)}</p></div><details class="own-answer"><summary>自分の回答</summary><p>${esc(own)}</p></details><p class="grading-point"><strong>自己採点の観点</strong> ${esc(detail.grading)}</p><div data-grade-box="${esc(field.id)}"></div><h4><span class="explanation-tag tag-thinking">思</span> 解答までの道筋</h4><ol>${detail.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol><h4><span class="explanation-tag tag-knowledge">知</span> 必要な知識</h4><p>${esc(detail.knowledge)}</p><h4><span class="explanation-tag tag-passage">本</span> 本文の注目ポイント</h4><p>${esc(detail.focus.text)}</p><p class="field-note">問題冊子：${detail.focus.pages.map(page => `<a href="${esc(problemUrl)}#page=${page}" target="_blank" rel="noopener">PDF ${page}ページ ↗</a>`).join(' / ')}</p><h4><span class="explanation-tag tag-pattern">定</span> 解くときの定石</h4><p>${esc(detail.pattern)}</p></article>`;
  }).join('')}<footer>出典：IPA ${esc(examLabel(paper, question))} 問題・解答例・採点講評。<br>解説更新日：${esc(data.reviewedOn)} · <a href="${backUrl}">回答画面へ戻る</a></footer>`;
  renderGrades();
}
main.addEventListener('click', event => {
  if (event.target.closest('#backup-explanation')) {
    const url = URL.createObjectURL(new Blob([exportExamBackup(answers, practice)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `nwordbook-exam-answers-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const jump = event.target.closest('[data-jump]');
  if (jump) { event.preventDefault(); document.getElementById(jump.dataset.jump).scrollIntoView({ behavior: 'smooth' }); }
  const button = event.target.closest('[data-grade]');
  if (button) { practice.mark(button.dataset.field, button.dataset.grade === 'clear' ? null : button.dataset.grade, answers.answers); renderGrades(); }
});
window.addEventListener('hashchange', () => { if (catalog && /^#\d{4}-[12]-[123]$/.test(location.hash)) { ({ paper, question } = parseExamSelection(location.hash, catalog)); render(); } });
window.addEventListener('pageshow', event => { if (event.persisted && catalog) { answers = createExamStore(catalog); practice = createPracticeStore(catalog); practice.pauseOthers(null); render(); } });
window.addEventListener('beforeunload', event => { if (practice && !practice.persistent) { event.preventDefault(); event.returnValue = ''; } });
try {
  const responses = await Promise.all([fetch(new URL('../study-data/exams.json', import.meta.url)), fetch(new URL('../study-data/explanations.json', import.meta.url))]);
  if (responses.some(r => !r.ok)) throw new Error('解説を取得できません。再読み込みしてください。');
  catalog = validateExamCatalog(await responses[0].json());
  data = validateExplanations(await responses[1].json(), catalog);
  answers = createExamStore(catalog); practice = createPracticeStore(catalog); practice.pauseOthers(null);
  ({ paper, question } = parseExamSelection(location.hash, catalog));
  history.replaceState(null, '', `#${paper.id}-${question.number}`); render();
} catch (error) { main.innerHTML = `<h1>解説を読み込めませんでした</h1><p>${esc(error.message)}</p><a href="./exam.html">回答画面へ戻る</a>`; }
