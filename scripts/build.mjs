import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './data.mjs';
import { validate } from './validate.mjs';

export async function build() {
  const data = await validate();
  await mkdir(join(root, 'dist/src'), { recursive: true });
  await mkdir(join(root, 'dist/study-data'), { recursive: true });
  for (const path of ['index.html', 'favicon.svg', 'src/app.js', 'src/domain.js', 'src/content.js', 'src/terminology.js', 'src/storage.js', 'src/styles.css', 'src/learning.css']) await copyFile(join(root, path), join(root, 'dist', path));
  // The audit ledger and research reports are never part of the browser payload.
  await writeFile(join(root, 'dist/study-data/catalog.json'), JSON.stringify(data));
  await writeFile(join(root, 'dist/.nojekyll'), '');
  console.log('ビルド OK → dist/');
}
await build();
