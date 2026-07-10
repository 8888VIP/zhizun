import { db, dbReady, run } from './db.mjs';

await dbReady;
const result = await run(`UPDATE images SET status = 'available', last_used_at = NULL
  WHERE status = 'cooling' AND last_used_at IS NOT NULL
  AND datetime(last_used_at) <= datetime('now', '-14 days')`);
console.log(`本次重置了${result.changes}张图片`);
db.close();
