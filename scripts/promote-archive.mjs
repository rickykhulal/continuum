/**
 * Promote a staged FIRMS archive into the published bundle.
 *
 *   node scripts/backfill-archive.mjs --out=data_raw/firms_archive/archive_staging.json
 *   node scripts/promote-archive.mjs
 *
 * The backfill writes to a staging path so the published bundle stays frozen while observations
 * are still arriving: an in-flight rewrite changes the manifest hash under whatever verification is
 * running and makes every golden fixture a moving target. Promotion is the only route from stage to
 * public/data, and it refuses a stage that would make the record worse rather than better.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = process.argv[2] || path.join(ROOT, 'data_raw', 'firms_archive', 'archive_staging.json');
const DEST = path.join(ROOT, 'public', 'data', 'archive_daily.json');

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

if (!fs.existsSync(STAGE)) {
  console.error(`promote: no staged archive at ${path.relative(ROOT, STAGE)} — run the backfill with --out first.`);
  process.exit(2);
}

const stage = read(STAGE);
if (stage.schema !== 'continuum-archive-1') {
  console.error(`promote: staged schema is ${stage.schema}, expected continuum-archive-1`);
  process.exit(2);
}

let days = 0;
let detections = 0;
const perRegion = [];
for (const [id, block] of Object.entries(stage.regions || {})) {
  let n = 0;
  let sum = 0;
  for (const rows of Object.values(block.days || {})) {
    for (const [, c] of rows) {
      n++;
      sum += c;
    }
  }
  const spans = Object.keys(block.covered || {}).length;
  if (n === 0 && spans === 0) continue;
  perRegion.push(`${id} ${n} days / ${sum.toLocaleString()} detections / ${spans} sensor lanes`);
  days += n;
  detections += sum;
}

if (days === 0) {
  console.error('promote: staged archive has no observed days — refusing to publish an empty overlay.');
  process.exit(2);
}

/**
 * The cursor and the cells have to tell the same story. `covered[]` is derived from the lane's
 * done count, and an overlay synthesises an observed zero for every covered day with no cell — so a
 * stage whose cells sum below the rows it aggregated has windows the cursor claims and the file has
 * lost. That is how the two-writer race presented, and it is the one defect promotion must never
 * inherit: 798,822 cells under a 1,106,566-row cursor would have shipped invented zeros.
 */
if (typeof stage.rows === 'number' && detections !== stage.rows) {
  console.error(`promote: cells sum ${detections.toLocaleString()} detections but the cursor aggregated ${stage.rows.toLocaleString()} — ${Math.abs(detections - stage.rows).toLocaleString()} row gap; the stage is not a single-writer product.`);
  process.exit(2);
}

const prior = fs.existsSync(DEST) ? read(DEST) : null;
const priorDays = prior ? Object.values(prior.regions || {}).reduce((s, b) => s + Object.values(b.days || {}).reduce((x, r) => x + r.length, 0), 0) : 0;
if (priorDays > 0 && days < priorDays) {
  console.error(`promote: stage has ${days} observed days, the published bundle has ${priorDays} — refusing to shrink coverage.`);
  process.exit(2);
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
const tmp = `${DEST}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(stage));
fs.renameSync(tmp, DEST);

console.log(`promote: ${days} observed days / ${detections.toLocaleString()} detections from ${stage.requests} requests`);
for (const line of perRegion) console.log(`  ${line}`);
console.log(`published to ${path.relative(ROOT, DEST)} — next: npm run data && npm run bundle && npm test`);
