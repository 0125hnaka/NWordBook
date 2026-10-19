import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root } from './data.mjs';
import { validate } from './validate.mjs';
import { validateExamCatalog } from '../src/exams.js';
import { verifyExamAssets } from './exam-assets.mjs';
import { loadAllExplanations } from './explanation-data.mjs';
import { loadExamAnswerLimits } from './exam-answer-limits.mjs';

export async function build() {
  const data = await validate();
  const exams = await loadExamAnswerLimits(validateExamCatalog(JSON.parse(await readFile(join(root, 'data/exams/catalog.json'), 'utf8'))));
  const pdfs = await verifyExamAssets(exams);
  const explanations = await loadAllExplanations(exams);
  await mkdir(join(root, 'dist/src'), { recursive: true });
  await mkdir(join(root, 'dist/study-data'), { recursive: true });
  const paths = ['index.html', 'exam.html', 'exam-explanation.html', 'favicon.svg', 'src/app.js', 'src/domain.js', 'src/content.js', 'src/detailed-explanations.js', 'src/terminology.js', 'src/storage.js', 'src/predictions.js', 'src/question-codes.js', 'src/question-contexts.js', 'src/exams.js', 'src/exam-storage.js', 'src/exam-navigation.js', 'src/exam-pdfs.js', 'src/exam-app.js', 'src/exam-practice.js', 'src/exam-grade-ui.js', 'src/exam-explanations.js', 'src/exam-explanation-app.js', 'src/pdf-viewer.js', 'src/styles.css', 'src/learning.css', 'src/exam.css'];
  const sources = await Promise.all(paths.map(path => readFile(join(root, path), 'utf8')));
  const revision = createHash('sha256').update(sources.join('\n')).update(JSON.stringify(data)).update(JSON.stringify(exams)).update(JSON.stringify(explanations)).digest('hex').slice(0, 16);
  for (const [index, path] of paths.entries()) {
    let source = sources[index];
    // One revision covers modules, styles and data, so cached releases cannot mix.
    if (path.endsWith('.html')) source = source.replace(/((?:href|src)=")([^"?]+\.(?:js|css|svg))(")/g, `$1$2?v=${revision}$3`);
    if (path.endsWith('.js')) source = source
      .replace(/(from\s+['"])(\.[^'"?]+\.js)(['"])/g, `$1$2?v=${revision}$3`)
      .replace('../study-data/catalog.json', `../study-data/catalog.json?v=${revision}`)
      .replace('../study-data/exams.json', `../study-data/exams.json?v=${revision}`)
      .replace('../study-data/explanations.json', `../study-data/explanations.json?v=${revision}`);
    await writeFile(join(root, 'dist', path), source);
  }
  // The audit ledger and research reports are never part of the browser payload.
  await writeFile(join(root, 'dist/study-data/catalog.json'), JSON.stringify(data));
  await writeFile(join(root, 'dist/study-data/exams.json'), JSON.stringify(exams));
  await writeFile(join(root, 'dist/study-data/explanations.json'), JSON.stringify(explanations));
  await cp(join(root, 'vendor'), join(root, 'dist/vendor'), { recursive: true });
  await mkdir(join(root, 'dist/past-exams'), { recursive: true });
  for (const doc of pdfs.documents) await cp(join(root, 'past-exams', doc.filename), join(root, 'dist/past-exams', doc.filename));
  await writeFile(join(root, 'dist/past-exams/manifest.json'), JSON.stringify(pdfs, null, 2) + '\n');
  await writeFile(join(root, 'dist/.nojekyll'), '');
  console.log('ビルド OK → dist/');
}
await build();
