#!/usr/bin/env node
// Lists every source carrying `origin: agent` (machine-verified against the
// cited page). Offline and read-only: useful for spot-checking a batch against
// the cited pages; a human who confirms a value may set `reviewed` in a normal PR.
// Usage: node scripts/list-agent-origin.mjs [slug ...]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const PRODUCTS = join(process.cwd(), 'products');

function collect(slug, obj, path, out) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.source && typeof obj.source === 'object' && obj.source.origin === 'agent') {
    out.push({ slug, field: path, url: obj.source.url, accessed: obj.source.accessed });
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'source') continue;
    if (Array.isArray(v)) v.forEach((item, i) => collect(slug, item, path ? `${path}.${k}[${i}]` : `${k}[${i}]`, out));
    else if (v && typeof v === 'object') collect(slug, v, path ? `${path}.${k}` : k, out);
  }
}

const dirs = existsSync(PRODUCTS)
  ? readdirSync(PRODUCTS).filter((d) => statSync(join(PRODUCTS, d)).isDirectory())
  : [];
const only = process.argv.slice(2);
const selected = only.length ? dirs.filter((d) => only.includes(d)) : dirs;

const rows = [];
for (const slug of selected) {
  const f = join(PRODUCTS, slug, 'product.yaml');
  if (!existsSync(f)) continue;
  try { collect(slug, parse(readFileSync(f, 'utf8')), '', rows); } catch { /* validate.mjs reports parse errors */ }
}

if (!rows.length) {
  console.log('No origin: agent sources. Every source is human-reviewed, seeded, or auto.');
} else {
  for (const r of rows) {
    const d = r.accessed instanceof Date ? r.accessed.toISOString().slice(0, 10) : r.accessed;
    console.log(`${r.slug}\t${r.field}\t${r.url}\t${d}`);
  }
  console.log(`\n${rows.length} machine-verified source(s) across ${new Set(rows.map((r) => r.slug)).size} entr${new Set(rows.map((r) => r.slug)).size === 1 ? 'y' : 'ies'}.`);
}
