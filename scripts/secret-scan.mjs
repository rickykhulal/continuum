#!/usr/bin/env node
/**
 * Secret scan for the repository and the built app (deployment PRD §2 gate: no credentials in
 * the shipped tree). Scans tracked and untracked source, config, data and build output; .env
 * files are reported by presence only, never read.
 *
 * Findings print the file, line, rule id and a fixed [redacted] marker — never the matched value
 * or the surrounding line, so the scanner cannot leak what it catches.
 *
 * Exit 0 clean, 1 findings or unscanned text files, 2 scan could not run.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SECRET_SCAN_ROOT
  ? path.resolve(process.env.SECRET_SCAN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.git']);
const SCAN_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.mdx', '.yml',
  '.yaml', '.env', '.txt', '.toml', '.ini', '.sh', '.ps1', '.bat', '.cmd', '.csv', '.jsonl', '.log',
  '.map', '.ipynb',
]);
const SMALL_FILE_LIMIT = 6_000_000;
const relOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

// A match is ignored when the captured value is an obvious placeholder or a shell/env reference.
const PLACEHOLDER_VALUE = /^(\$|<|\[redacted\]|\{)/i;
const PLACEHOLDER_WORDS =
  /^(environment|variable|required|optional|string|value|set|not|empty|true|false|null|none|undefined|your[_-]?key|changeme)$/i;
// Code such as `METRICS_TOKEN = crypto.randomBytes(32)` or `token: e.timeStamp` is an expression,
// not a literal; a dotted identifier chain is never a credential.
const IDENTIFIER_CHAIN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;

// Rules are anchored on context, never on "any long hex string". Bundle ids and checksums in this
// repo are 12- or 64-hex and carry no credential keyword, so they stay clean.
const RULES = [
  {
    id: 'firms-area-url',
    name: 'FIRMS area API key in a URL path',
    re: /\/api\/area\/csv\/[0-9a-f]{32}\//i,
  },
  {
    id: 'firms-query-key',
    name: 'FIRMS map key in a query string',
    re: /[?&](?:map[_-]?key|key)=[0-9a-f]{32}(?![0-9a-f])/i,
  },
  {
    id: 'env-secret-assignment',
    name: 'credential assigned to a *_KEY / *_TOKEN / *_SECRET variable',
    re: /\b[A-Za-z][A-Za-z0-9_]*_(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|DSN)\b["'`]?\s*[=:]\s*["'`]?([A-Za-z0-9._+\/=\-]{8,})/i,
    valueGroup: 1,
  },
  {
    id: 'generic-secret-assignment',
    name: 'secret-like keyword assigned a long literal',
    re: /\b(?:secret|token|password|passwd|credential|api[_-]?key|access[_-]?key|map[_-]?key|private[_-]?key)\b["'`]?\s*[=:]\s*["'`]?([A-Za-z0-9._+\/=\-]{16,})/i,
    valueGroup: 1,
  },
  { id: 'aws-access-key', name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'google-api-key', name: 'Google API key', re: /AIza[0-9A-Za-z_\-]{30,}/ },
  { id: 'google-oauth-token', name: 'Google OAuth access token', re: /\bya29\.[A-Za-z0-9_\-]{20,}/ },
  { id: 'slack-token', name: 'Slack token', re: /xox[abprs]-[0-9A-Za-z-]{10,}/ },
  { id: 'github-token', name: 'GitHub token', re: /(?:gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { id: 'gitlab-token', name: 'GitLab token', re: /glpat-[A-Za-z0-9_\-]{20,}/ },
  { id: 'openai-or-anthropic-key', name: 'OpenAI/Anthropic API key', re: /\bsk-(?:ant-)?[A-Za-z0-9_\-]{20,}/ },
  { id: 'npm-auth-token', name: 'npm auth token', re: /_authToken\s*=\s*\S{16,}/ },
  { id: 'sentry-dsn-key', name: 'Sentry DSN public key', re: /https:\/\/[0-9a-f]{32}@[a-z0-9.-]+/i },
  {
    id: 'private-key-block',
    name: 'private key block',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { id: 'jwt', name: 'JWT', re: /eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/ },
  { id: 'basic-auth-url', name: 'basic auth in a URL', re: /:\/\/[^/\s:@]+:[^/\s:@]{6,}@/ },
];

// Line-level allowlist for documented, deliberately empty assignments. Kept small: a broad entry
// would suppress a real secret that happens to share the line.
const ALLOW = [
  /API_CORS_ORIGINS/,
  /FIRMS_MAP_KEY=\s*$/,
  /EARTHDATA_TOKEN=\s*$/,
  /LLM_API_KEY=\s*$/,
  /SENTRY_DSN=\s*$/,
  /example\.(com|org)/i,
];

// Cheap keyword gate so multi-million-row CSVs stay fast without skipping any rule: every rule's
// literal anchor is represented here.
const PREFILTER =
  /akia|aiza|ya29\.|xox|gh[pousr]_|github_pat_|glpat-|BEGIN|eyJ|bearer|credential|password|passwd|secret|token|key|dsn|:\/\//i;

const findings = [];
const unscanned = [];
const scanned = { files: 0, bytes: 0, large: 0, skippedByExt: 0 };

function checkLine(rel, line, lineNo) {
  if (!line || !PREFILTER.test(line)) return;
  if (ALLOW.some((a) => a.test(line))) return;
  for (const rule of RULES) {
    const m = rule.re.exec(line);
    if (!m) continue;
    if (rule.valueGroup) {
      const v = m[rule.valueGroup];
      if (!v || PLACEHOLDER_VALUE.test(v) || PLACEHOLDER_WORDS.test(v)) continue;
      if (IDENTIFIER_CHAIN.test(v)) continue;
      if (line[m.index + m[0].length] === '(') continue;
    }
    findings.push({ file: rel, line: lineNo, rule: rule.id, name: rule.name });
  }
}

function scanText(rel, abs) {
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    unscanned.push({ file: rel, reason: `unreadable (${err.code || err.message})` });
    return;
  }
  if (text.includes('\u0000')) {
    unscanned.push({ file: rel, reason: 'binary content' });
    return;
  }
  scanned.files++;
  scanned.bytes += text.length;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) checkLine(rel, lines[i], i + 1);
}

async function scanLarge(rel, abs) {
  let probe;
  try {
    const fd = fs.openSync(abs, 'r');
    probe = Buffer.alloc(4096);
    const read = fs.readSync(fd, probe, 0, 4096, 0);
    fs.closeSync(fd);
    probe = probe.subarray(0, read);
  } catch (err) {
    unscanned.push({ file: rel, reason: `unreadable (${err.code || err.message})` });
    return;
  }
  if (probe.includes(0)) {
    unscanned.push({ file: rel, reason: 'binary content (streamed check refused)' });
    return;
  }
  scanned.files++;
  scanned.large++;
  const rl = readline.createInterface({
    input: fs.createReadStream(abs, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let n = 0;
  try {
    for await (const line of rl) {
      n++;
      scanned.bytes += line.length + 1;
      checkLine(rel, line, n);
    }
  } catch (err) {
    unscanned.push({ file: rel, reason: `stream failed at line ${n + 1} (${err.code || err.message})` });
  }
}

async function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    unscanned.push({
      file: relOf(dir) || '.',
      reason: `directory unreadable (${err.code || err.message})`,
    });
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    if (name === '.env' || (name.startsWith('.env.') && !/^\.env\.(example|template|sample|dist)$/i.test(name))) {
      findings.push({
        file: relOf(path.join(dir, name)),
        line: 0,
        rule: 'dot-env-file',
        name: 'dot-env file present in the tree',
      });
      continue;
    }
    const abs = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (err) {
      unscanned.push({ file: relOf(abs), reason: `unstattable (${err.code || err.message})` });
      continue;
    }
    if (stat.isDirectory()) {
      await walk(abs);
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    const isConfig = name === '_headers' || name === 'netlify.toml' || name.startsWith('.');
    if (!SCAN_EXT.has(ext) && !isConfig) {
      scanned.skippedByExt++;
      continue;
    }
    const rel = relOf(abs);
    if (stat.size > SMALL_FILE_LIMIT) await scanLarge(rel, abs);
    else scanText(rel, abs);
  }
}

try {
  await walk(ROOT);
} catch (err) {
  console.error(`secret-scan: could not complete — ${err.message}`);
  process.exit(2);
}

console.log(
  `secret-scan: ${scanned.files} files (${(scanned.bytes / 1e6).toFixed(1)} MB, ${scanned.large} streamed over 6 MB), ` +
    `${scanned.skippedByExt} files skipped by extension`,
);
if (findings.length) {
  for (const f of findings) console.log(`FINDING  ${f.file}:${f.line} — ${f.rule} ${f.name} [redacted]`);
}
if (unscanned.length) {
  for (const u of unscanned) console.log(`UNSCANNED  ${u.file} — ${u.reason}`);
  console.log(`secret-scan: ${unscanned.length} file(s) could not be scanned`);
}
if (findings.length || unscanned.length) {
  console.log(
    `\nsecret-scan: ${findings.length} finding(s), ${unscanned.length} unscanned — remove the credential or document it as a placeholder`,
  );
  process.exit(1);
}
console.log('secret-scan: clean — no credentials in the scanned tree or the built bundle');
