import { currentGrade, gradeSummary, GRADE_LABELS } from './exam-practice.js';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function gradeControls(field, answers, marks) {
  if (field.invalid) return '<p class="field-note">不備のある設問：採点対象外</p>';
  const grade = currentGrade(field, answers, marks);
  const stale = marks[field.id] && !grade;
  return `<div class="grade-buttons" role="group" aria-label="${escapeHtml(field.label)}の自己採点">${Object.entries(GRADE_LABELS).map(([value, label]) => `<button type="button" data-grade="${value}" data-field="${escapeHtml(field.id)}" aria-label="${label}：${{ correct: '正解', partial: '部分的に正解', incorrect: '不正解' }[value]}" aria-pressed="${grade === value}">${label}</button>`).join('')}<button type="button" data-grade="clear" data-field="${escapeHtml(field.id)}" class="grade-clear">解除</button><span class="field-note">${stale ? '回答を変更しました。再採点してください。' : grade ? '採点済み' : '未採点'}</span></div>`;
}
export function scoreText(question, answers, marks) {
  const s = gradeSummary(question, answers, marks);
  return `目安 ${s.score ?? '—'} / 100点${s.pending ? '（暫定）' : ''} · ${s.graded} / ${s.total}項目を採点 · ○${s.correct} △${s.partial} ×${s.incorrect} · 未採点${s.pending}${s.excluded ? ` · 対象外${s.excluded}` : ''}`;
}
export function updateGradeBoxes(root, question, answers, marks) {
  const active = document.activeElement;
  const focus = active?.matches('[data-grade]') ? { field: active.dataset.field, grade: active.dataset.grade } : null;
  for (const box of root.querySelectorAll('[data-grade-box]')) {
    box.innerHTML = gradeControls(question.fields.find(f => f.id === box.dataset.gradeBox), answers, marks);
  }
  if (focus) [...root.querySelectorAll('[data-grade]')].find(button => button.dataset.field === focus.field && button.dataset.grade === focus.grade)?.focus({ preventScroll: true });
}
