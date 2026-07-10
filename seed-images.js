import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { db, dbReady, projectRoot, run } from './db.mjs';

const imageDir = join(projectRoot, 'public', 'images');
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
await dbReady;
const files = (await readdir(imageDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
  .map((entry) => entry.name).sort();

let imported = 0;
for (const filename of files) {
  const prefix = filename.toLowerCase().split('-')[0];
  const tag = prefix === 'kouwei' ? '口味' : prefix === 'huanjing' ? '环境' : null;
  if (!tag) continue;
  const result = await run(`INSERT INTO images (image_path, tag) VALUES (?, ?)
    ON CONFLICT(image_path) DO UPDATE SET tag = excluded.tag`, [`/images/${filename}`, tag]);
  if (result.changes > 0) imported += 1;
}
console.log(`本次导入了${imported}张图片`);
db.close();
