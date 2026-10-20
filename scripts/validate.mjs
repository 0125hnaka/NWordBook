import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCatalog, eligibleCards, initialState } from '../src/domain.js';
import { readDataset, root } from './data.mjs';
import { parsePredictionSource } from './import-predictions.mjs';
import { verifyPastTerms } from './past-term-data.mjs';

export async function validate() {
  const data = await readDataset();
  await verifyPastTerms(data.pastTerms);
  const catalog = createCatalog({ ...data, editorial: undefined });
  createCatalog(data); // Also validate separate editorial references and added cards.
  const predictionSource = await readFile(join(root, data.predictions.source.path), 'utf8');
  if (JSON.stringify(parsePredictionSource(predictionSource)) !== JSON.stringify(data.predictions)) throw new Error('予想教材と取り込み元が一致しません。');
  for (const file of data.manifest.files) {
    const hash = createHash('sha256').update(await readFile(join(root, file.path))).digest('hex');
    if (hash !== file.sha256) throw new Error(`原本ハッシュ不一致: ${file.path}`);
  }
  const counts = {
    atomCount: data.atoms.length,
    questionCount: data.questions.length,
    verifiedAtomCount: data.atoms.filter(a => a.verified).length,
    unverifiedAtomCount: data.atoms.filter(a => !a.verified).length,
    globallyEnabledQuestionCount: catalog.cards.filter(q => q.defaultEnabled && q.atom.verified).length,
    initialProfileEnabledQuestionCount: eligibleCards(catalog, initialState(catalog), { groupId: 'all', preset: 'all' }).length,
    unverifiedQuestionCount: catalog.cards.filter(q => !q.atom.verified).length,
  };
  for (const [key, count] of Object.entries(counts)) {
    if (count !== data.manifest[key]) throw new Error(`件数不一致 ${key}: ${count} / ${data.manifest[key]}`);
  }
  if (data.first100.length !== 100 || data.first100.some(id => !data.atoms.some(a => a.id === id && a.verified && a.priority === 'A'))) throw new Error('推奨100が確認済みAランク100原子ではありません。');
  console.log('教材検証 OK', JSON.stringify(counts));
  return data;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await validate();
