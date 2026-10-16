/** Editorial additions are separate from the immutable research dataset. */
export function validateEditorial(data) {
  const editorial = data.editorial;
  if (!editorial) return;
  const error = message => { throw new Error(`編集教材: ${message}`); };
  if (editorial.schemaVersion !== 1 || !Array.isArray(editorial.terms) || !Array.isArray(editorial.questionRevisions)) error('形式が不正です。');
  const atomIds = new Set(data.atoms.map(a => a.id));
  const questionIds = new Set(data.questions.map(q => q.id));
  const termIds = new Set(), revisedIds = new Set();
  for (const t of editorial.terms) {
    if (typeof t.id !== 'string' || !/^[A-Z0-9_]+$/.test(t.id) || termIds.has(t.id) || !atomIds.has(t.atomId) || typeof t.term !== 'string' || !t.term.trim() || typeof t.meaning !== 'string' || !t.meaning.trim()) error('用語のID・参照・内容が不正です。');
    termIds.add(t.id);
    for (const direction of ['meaning', 'name']) if (questionIds.has(`TERM_${t.id}_${direction}`)) error('追加カードIDが重複しています。');
  }
  for (const r of editorial.questionRevisions) {
    if (!questionIds.has(r.id) || revisedIds.has(r.id) || typeof r.question !== 'string' || !r.question.trim() || typeof r.answerFocus !== 'string' || !r.answerFocus.trim()) error(`問いの修正が不正です: ${r.id}`);
    if (Object.keys(r).some(key => !['id', 'question', 'answerFocus', 'answer'].includes(key))) error(`問いの修正にはID・問題・回答対象・解答だけを指定してください: ${r.id}`);
    if (r.answer !== undefined && (typeof r.answer !== 'string' || !r.answer.trim())) error(`修正解答が空です: ${r.id}`);
    revisedIds.add(r.id);
  }
}

export function answerGuide(question) {
  if (question.answerFocus) return question.answerFocus;
  return {
    term: '該当する用語名・略称・値を短く答えてください。',
    mechanism: 'どの処理・条件が原因になり、何が起こるかを1〜2文で説明してください。',
    case: '示された構成・条件での結論を答えてください。理由を聞かれている場合は、その根拠も添えてください。',
    change: '変更する設定や、変更後に必要になる対応を答えてください。',
    failure: '障害によって影響を受ける通信・装置・動作を答えてください。',
  }[question.questionType];
}

export function buildLearningQuestions(data) {
  validateEditorial(data);
  const revisions = new Map((data.editorial?.questionRevisions || []).map(r => [r.id, r]));
  const questions = data.questions.map(q => {
    const edited = { ...q, ...revisions.get(q.id), termDirection: q.questionType === 'term' ? 'name' : undefined };
    if (edited.question.startsWith('次の原則が成り立つ仕組みを説明せよ。\n')) {
      edited.question = `確認する動作・条件：\n${edited.question.split('\n').slice(1).join('\n')}\n\nこの動作・制約が生じる理由を、原因となる処理と結果のつながりが分かるように説明してください。`;
    }
    return { ...edited, answerRubric: edited.answerRubric && revisions.get(q.id)?.answer ? { ...edited.answerRubric, requiredConcepts: [edited.answer] } : edited.answerRubric, answerFocus: answerGuide(edited), editorialRevised: revisions.has(q.id) };
  });
  const atoms = new Map(data.atoms.map(a => [a.id, a]));
  for (const term of data.editorial?.terms || []) {
    const atom = atoms.get(term.atomId);
    for (const direction of ['meaning', 'name']) {
      questions.push({
        id: `TERM_${term.id}_${direction}`, knowledgeAtomId: atom.id, category: atom.category,
        questionType: 'term', termDirection: direction, level: 1, difficulty: 1,
        question: direction === 'meaning' ? `「${term.term}」とは何ですか。` : `${term.meaning}\n\nこの用語の名前を答えてください。`,
        answer: direction === 'meaning' ? term.meaning : term.term,
        answerFocus: direction === 'meaning' ? '用語の意味・役割を、短い一文で答えてください。' : '用語名または略称を答えてください。',
        explanation: atom.mechanism, thinkingTrigger: atom.thinkingTrigger,
        importance: atom.importance, priority: atom.priority, classification: 'K',
        defaultEnabled: atom.verified && atom.defaultEnabled, sourceRefs: atom.sourceRefs,
        origin: 'authored_generalization', isOriginalIpaQuestion: false,
        editorialAdded: true, term: term.term, estimatedSeconds: 20,
      });
    }
  }
  return questions;
}
