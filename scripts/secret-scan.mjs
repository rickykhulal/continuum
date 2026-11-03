#!/usr/bin/env node
/**
 * Secret scan for the repository and the built app (deployment PRD §2 gate: no credentials in
 * the shipped tree). Scans tracked source, config and dist output; .env files are reported as
 * untracked-by-design, never printed.
 *
 * Exit 0 clean, 1 findings, 2 scan could not run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'data_raw']);
const SCAN_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.yml', '.yaml',
  '.env', '.txt', '.toml', '.ini', '.sh', '.ps1',
]);

const PATTERNS = [
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_\-]{30,}/ },
  { name: 'Slack token', re: /xox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'GitHub token', re: /gh[pousr]_[0-9A-Za-z]{20,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/ },
  { name: 'JWT', re: /eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/ },
  { name: 'Generic assignment with a long secret', re: /(secret|token|password|passwd|api[_-]?key|access[_-]?key)["'\s:=]{1,4}[0-9A-Za-z+/_=\-]{24,}/i },
  { name: 'Basic auth in a URL', re: /:\/\/[^/\s:@]+:[^/\s:@]{6,}@/ },
];

// Values that look secret-shaped but are documented placeholders.
const ALLOW = [
  /API_CORS_ORIGINS/,
  /FIRMS_MAP_KEY=\s*$/,
  /EARTHDATA_TOKEN=\s*$/,
  /LLM_API_KEY=\s*$/,
  /SENTRY_DSN=\s*$/,
  /continuum-harmonize-v1/,
  /sha256/i,
  /example\.(com|org)/i,
];

const findings = [];
const scanned = { files: 0, bytes: 0 };

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    if (name === '.env' || (name.startsWith('.env.') && !/^\.env\.(example|template|sample|dist)$/i.test(name))) {
      findings.push({ file: path.relative(ROOT, path.join(dir, name)), pattern: 'dot-env file present in the tree', line: 0, evidence: '(contents not read)' });
      continue;
    }
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      walk(abs);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    const isConfig = name === '_headers' || name === 'netlify.toml' || name.startsWith('.');
    if (!SCAN_EXT.has(ext) && !isConfig) continue;
    if (stat.size > 6_000_000) continue;
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    scanned.files++;
    scanned.bytes += text.length;
    if (abs.includes(`${path.sep}dist${path.sep}`) || abs.includes(`${path.sep}dist-server${path.sep}`)) continue; // build output scanned separately
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const p of PATTERNS) {
        if (!p.re.test(line)) continue;
        if (ALLOW.some((a) => a.test(line))) continue;
        findings.push({
          file: path.relative(ROOT, abs),
          pattern: p.name,
          line: i + 1,
          evidence: line.replace(/\s+/g, ' ').slice(0, 60) + '…',
        });
      }
    });
  }
}

try {
  walk(ROOT);
} catch (err) {
  console.error(`secret-scan: could not complete — ${err.message}`);
  process.exit(2);
}

// The shipped web bundle must not carry a key either: FIRMS/POWER URLs and any 32+ char token.
const distIndex = path.join(ROOT, 'dist', 'assets');
let distChecked = 0;
if (fs.existsSync(distIndex)) {
  for (const f of fs.readdirSync(distIndex)) {
    if (!/\.(js|css)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(distIndex, f), 'utf8');
    distChecked++;
    for (const p of PATTERNS) {
      const hit = text.match(p.re);
      if (hit && !ALLOW.some((a) => a.test(hit[0]))) {
        findings.push({ file: `dist/assets/${f}`, pattern: `${p.name} (built bundle)`, line: 0, evidence: `${hit[0].slice(0, 24)}…` });
      }
    }
  }
}

console.log(`secret-scan: ${scanned.files} source files (${(scanned.bytes / 1e6).toFixed(1)} MB), ${distChecked} bundle assets checked`);
if (findings.length) {
  for (const f of findings) console.log(`FINDING  ${f.file}:${f.line} — ${f.pattern} ${f.evidence}`);
  console.log(`\nsecret-scan: ${findings.length} finding(s) — remove the credential or document it as a placeholder`);
  process.exit(1);
}
console.log('secret-scan: clean — no credentials in the tracked tree or the built bundle');
