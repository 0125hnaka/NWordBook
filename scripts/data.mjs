import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const readJson = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
export async function readDataset() {
  const [atoms, questions, first100, profile, manifest, editorial, terminology, predictions, questionCodes, details, questionContexts, pastTerms] = await Promise.all([
    readJson('data/source/knowledge_atoms.json'), readJson('data/source/question_pool.json'),
    readJson('data/source/first_100_atom_ids.json'), readJson('config/learning_profiles.json'), readJson('data/source/dataset_manifest.json'), readJson('data/editorial/learning_content.json'), readJson('data/editorial/ipa_terminology.json'),
    readJson('data/editorial/prediction_questions.json'),
    readJson('data/editorial/question_codes.json'), readJson('data/editorial/detailed_explanations.json'),
    readJson('data/editorial/question_contexts.json'),
    readJson('data/editorial/past_exam_terms.json'),
  ]);
  return { atoms, questions, first100, profile, manifest, editorial, terminology, predictions, questionCodes, details, questionContexts, pastTerms };
}
