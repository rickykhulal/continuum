import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const A = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'analytics.mjs')).href);
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'live_fires.json'), 'utf8'));

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};

for (const id of ['chilecito', 'pantanal', 'california', 'greece', 'amazon', 'nepal', 'southeast-australia']) {
  const region = A.getRegion(id);
  const records = A.regionRecord(region, live);
  const today = records[records.length - 1].date;
  const weeks = 8;
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - (weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
  const weekly = (year) => {
    const out = [];
    for (let w = 0; w < weeks; w++) {
      const a = new Date(Date.parse(`${year}${start.slice(4)}T00:00:00Z`) + w * 7 * 86400000).toISOString().slice(0, 10);
      const b = new Date(Date.parse(a) + 6 * 86400000).toISOString().slice(0, 10);
      out.push(records.filter((r) => r.date >= a && r.date <= b).reduce((s, r) => s + r.harmonized, 0));
    }
    return out;
  };
  const shapes = [];
  const sims = [];
  const obs = weekly(2026).map((v) => v / mean(weekly(2026)));
  for (let y = 2002; y <= 2025; y++) {
    const vals = weekly(y);
    if (mean(vals) < 1) continue;
    const s = vals.map((v) => v / mean(vals));
    shapes.push(s);
    sims.push(100 * (1 - Math.sqrt(mean(s.map((v, i) => (v - obs[i]) ** 2))) / 1.2));
  }
  const avgShapeSd = mean(shapes.map((s) => sd(s)));
  const spread = sd(sims);
  const gap = Math.max(...sims) - [...sims].sort((a, b) => b - a)[1];
  console.log(
    id.padEnd(20),
    'week-shape sd', avgShapeSd.toFixed(3),
    'sim mean', mean(sims).toFixed(1), 'sd', spread.toFixed(2),
    'top-2 gap', gap.toFixed(2),
    'annual total sd/mean',
    (() => {
      const ann = [];
      for (let y = 2002; y <= 2025; y++) {
        const t = records.filter((r) => r.date.startsWith(String(y))).reduce((s, r) => s + r.harmonized, 0);
        if (t > 0) ann.push(t);
      }
      return (sd(ann) / mean(ann)).toFixed(3);
    })(),
  );
}
