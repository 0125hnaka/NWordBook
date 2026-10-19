/** Normalize display prose only. Keep IDs, protocol identifiers and URLs intact. */
export function validateTerminology(glossary) {
  if (!glossary) return;
  const fail = () => { throw new Error('IPA用語表の形式・出典・表記対応が不正です。'); };
  if (glossary.schemaVersion !== 1 || typeof glossary.revision !== 'string' || !Array.isArray(glossary.sources) || !Array.isArray(glossary.rules)) fail();
  const sources = new Set(), aliases = new Set(), canonical = new Set();
  for (const source of glossary.sources) {
    if (typeof source.id !== 'string' || !source.id || sources.has(source.id) || typeof source.title !== 'string' || typeof source.location !== 'string') fail();
    try { const url = new URL(source.url); if (url.protocol !== 'https:' || url.hostname !== 'www.ipa.go.jp' || !url.pathname.startsWith('/shiken/')) fail(); } catch { fail(); }
    sources.add(source.id);
  }
  for (const rule of glossary.rules) {
    if (typeof rule.canonical !== 'string' || !rule.canonical.trim() || canonical.has(rule.canonical) || !Array.isArray(rule.aliases) || !rule.aliases.length || !Array.isArray(rule.sourceIds) || !rule.sourceIds.length || rule.sourceIds.some(id => !sources.has(id))) fail();
    canonical.add(rule.canonical);
    for (const alias of rule.aliases) {
      if (typeof alias !== 'string' || !alias.trim() || alias === rule.canonical || aliases.has(alias)) fail();
      aliases.add(alias);
    }
  }
  // Avoid replacement chains: the result must be stable when normalized again.
  if ([...canonical].some(value => aliases.has(value))) fail();
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createIpaNormalizer(glossary) {
  validateTerminology(glossary);
  if (!glossary?.rules.length) return text => text;
  const replacements = new Map(glossary.rules.flatMap(rule => rule.aliases.map(alias => [alias, rule.canonical])));
  const alternatives = [...replacements.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const words = new RegExp(`(?<![A-Za-z0-9_./-])(?:${alternatives})(?![A-Za-z0-9_./-])`, 'g');
  // Literal message/header names and hostnames must not become Japanese words.
  const protectedText = /https?:\/\/[^\s<>"'）]+|`[^`]*`|Windows Server(?: \d{4})?|\bServer(?=\s*(?:ヘッダー?|:))/g;
  return text => {
    if (typeof text !== 'string') return text;
    let cursor = 0, result = '';
    for (const match of text.matchAll(protectedText)) {
      result += text.slice(cursor, match.index).replace(words, word => replacements.get(word));
      result += match[0];
      cursor = match.index + match[0].length;
    }
    return result + text.slice(cursor).replace(words, word => replacements.get(word));
  };
}

/** Explicit fields ensure source URLs, stable IDs and verification flags stay untouched. */
export function normalizeStudyFields(value, normalize) {
  const result = { ...value };
  for (const key of ['question', 'context', 'answer', 'answerFocus', 'explanation', 'thinkingTrigger', 'term', 'subcategory', 'oneLineRule', 'mechanism', 'commonTrap', 'whyItMatters', 'priorityBasis', 'commentaryInsight']) {
    if (typeof result[key] === 'string') result[key] = normalize(result[key]);
  }
  for (const key of ['tags', 'patterns']) if (Array.isArray(result[key])) result[key] = result[key].map(normalize);
  if (result.answerRubric) result.answerRubric = { ...result.answerRubric, requiredConcepts: result.answerRubric.requiredConcepts?.map(normalize), commonWrongAnswer: normalize(result.answerRubric.commonWrongAnswer) };
  return result;
}
