export function normalizeQuestionCode(input) {
  if (typeof input !== 'string') return null;
  const match = input.normalize('NFKC').trim().toUpperCase().match(/^([QP])(\d+)$/);
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) return null;
  return `${match[1]}${String(Number(match[2])).padStart(match[1] === 'Q' ? 3 : 2, '0')}`;
}

/** The registry is append-only. Missing cards retain their reserved codes. */
export function assignQuestionCodes(cards, registry) {
  if (registry?.schemaVersion !== 1 || !registry.codes || typeof registry.codes !== 'object' || Array.isArray(registry.codes)) throw new Error('問題識別番号の対応表が不正です。');
  const byId = new Map();
  for (const [code, id] of Object.entries(registry.codes)) {
    if (normalizeQuestionCode(code) !== code || typeof id !== 'string' || !id || byId.has(id)) throw new Error('問題識別番号の重複・形式不正があります。');
    byId.set(id, code);
  }
  return cards.map(card => {
    const shortCode = byId.get(card.id);
    if (!shortCode || !shortCode.startsWith(card.prediction ? 'P' : 'Q')) throw new Error(`問題識別番号が未登録または区分不正です: ${card.id}`);
    return { ...card, shortCode };
  });
}

export function findQuestionByCode(catalog, input) {
  const code = normalizeQuestionCode(input);
  return code ? [...catalog.cards, ...catalog.predictionCards].find(card => card.shortCode === code) ?? null : null;
}
