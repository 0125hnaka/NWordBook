/** Situations are authored separately; answers, stable IDs and sources stay intact. */
export function validateQuestionContexts(data) {
  const d = data.questionContexts;
  const fail = message => { throw new Error(`問題の状況: ${message}`); };
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!record(d) || d.schemaVersion !== 1 || !text(d.revision) || !record(d.atoms) || !record(d.questions)) fail('形式が不正です。');
  const ids = new Set(data.atoms.map(a => a.id));
  if (Object.keys(d.atoms).length !== ids.size) fail('知識の件数が一致しません。');
  for (const id of ids) {
    const e = d.atoms[id];
    if (!record(e) || !text(e.context) || e.context.length < 35 || !text(e.prompt) || e.prompt.length < 15) fail(`状況・問いが不足しています: ${id}`);
    if (Object.keys(e).some(k => !['context', 'prompt'].includes(k))) fail(`未対応の編集項目です: ${id}`);
  }
  const questions = new Set(data.questions.filter(q => q.questionType !== 'term').map(q => q.id));
  for (const [id, e] of Object.entries(d.questions)) {
    if (!questions.has(id) || !record(e) || !text(e.question) || !text(e.answerFocus) || (e.context !== undefined && !text(e.context))) fail(`個別の問いが不正です: ${id}`);
    if (Object.keys(e).some(k => !['context', 'question', 'answerFocus'].includes(k))) fail(`解答などは状況編集へ含められません: ${id}`);
  }
}

export function contextualizeQuestions(questions, data) {
  // The original-only catalog is also used for audit/count validation.
  if (!data.editorial) return questions;
  return questions.map(q => {
    if (q.questionType === 'term') return q;
    const entry = data.questionContexts.atoms[q.knowledgeAtomId];
    const override = data.questionContexts.questions[q.id];
    const abstract = q.question.startsWith('確認する動作・条件：');
    return {
      ...q,
      context: override?.context || entry.context,
      question: override?.question || (abstract ? entry.prompt : q.question),
      answerFocus: override?.answerFocus || (abstract ? '示した状況について、問いで指定した仕組み・理由・比較対象を説明してください。' : q.answerFocus),
      contextualized: true,
      questionClarified: abstract || Boolean(override),
    };
  });
}

export function renderQuestionContext(card, escape) {
  return card.context ? `<section class="question-context" aria-label="状況・前提"><strong>状況・前提</strong><p>${escape(card.context)}</p></section>` : '';
}
