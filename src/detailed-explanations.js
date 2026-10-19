/** Authored long explanations live apart from the immutable question sources. */
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateDetailedExplanations(data) {
  const d = data.details;
  const fail = message => { throw new Error(`詳しい解説: ${message}`); };
  if (!object(d) || d.schemaVersion !== 1 || !text(d.revision) || !object(d.lessons) || !object(d.atoms) || !object(d.predictions)) fail('形式が不正です。');
  for (const [id, body] of Object.entries(d.lessons)) if (!text(body) || body.length < 80) fail(`前提知識が不足しています: ${id}`);
  const verify = (entries, ids, label) => {
    if (Object.keys(entries).length !== ids.size) fail(`${label}の件数が一致しません。`);
    for (const id of ids) {
      const e = entries[id];
      if (!object(e) || !Object.hasOwn(d.lessons, e.lesson) || !text(e.example) || e.example.length < 60) fail(`${label}の参照・具体例が不正です: ${id}`);
    }
    for (const id of Object.keys(entries)) if (!ids.has(id)) fail(`不明なIDです: ${id}`);
  };
  verify(d.atoms, new Set(data.atoms.map(a => a.id)), '知識');
  verify(d.predictions, new Set((data.predictions?.questions || []).map(q => q.id)), '予想問題');
}
export function addDetailedExplanations(cards, details, normalize) {
  return cards.map(card => {
    const entry = (card.prediction ? details.predictions : details.atoms)[card.prediction ? card.id : card.knowledgeAtomId];
    const sections = [
      { title: '前提となる知識', text: details.lessons[entry.lesson] },
      { title: '具体例で考える', text: entry.example },
      { title: '答えにつながる理由', text: card.prediction ? (card.kind === 'composite' ? card.answer : card.explanation) : card.atom.mechanism },
    ];
    return { ...card, detailSections: sections.map(s => ({ title: s.title, text: normalize(s.text) })) };
  });
}
export function renderDetailedExplanation(card, escape) {
  return `<section class="detailed-explanation" aria-label="詳しい解説"><h4>詳しい解説</h4><p class="detail-intro">前提から具体例をたどって、答えの理由を確認しましょう。例の数値・構成は理解のための仮定です。設問の条件と照らし合わせて読んでください。</p>${card.detailSections.map(section => `<section class="detail-section"><h5>${escape(section.title)}</h5>${section.text.split('\n').filter(p => p.trim()).map(p => `<p>${escape(p)}</p>`).join('')}</section>`).join('')}</section>`;
}
