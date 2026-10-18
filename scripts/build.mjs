import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root } from './data.mjs';
import { validate } from './validate.mjs';

export async function build() {
  const data = await validate();
  await mkdir(join(root, 'dist/src'), { recursive: true });
  await mkdir(join(root, 'dist/study-data'), { recursive: true });
  const paths = ['index.html', 'favicon.svg', 'src/app.js', 'src/domain.js', 'src/content.js', 'src/terminology.js', 'src/storage.js', 'src/predictions.js', 'src/question-codes.js', 'src/styles.css', 'src/learning.css'];
  const sources = await Promise.all(paths.map(path => readFile(join(root, path), 'utf8')));
  const revision = createHash('sha256').update(sources.join('\n')).update(JSON.stringify(data)).digest('hex').slice(0, 16);
  for (const [index, path] of paths.entries()) {
    let source = sources[index];
    // One revision covers modules, styles and data, so cached releases cannot mix.
    if (path.endsWith('.html')) source = source.replace(/((?:href|src)=")([^"?]+\.(?:js|css|svg))(")/g, `$1$2?v=${revision}$3`);
    if (path.endsWith('.js')) source = source
      .replace(/(from\s+['"])(\.[^'"?]+\.js)(['"])/g, `$1$2?v=${revision}$3`)
      .replace('../study-data/catalog.json', `../study-data/catalog.json?v=${revision}`);
    await writeFile(join(root, 'dist', path), source);
  }
  // The audit ledger and research reports are never part of the browser payload.
  await writeFile(join(root, 'dist/study-data/catalog.json'), JSON.stringify(data));
  await writeFile(join(root, 'dist/.nojekyll'), '');
  console.log('ビルド OK → dist/');
}
await build();
