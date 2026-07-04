#!/usr/bin/env node
// Monthly sampling audit: selects a deterministic 8-entry sample and emits a
// Markdown checklist for human accuracy review. Selection only — this script
// checks nothing itself; the human review it drives is the layer that catches
// what no substring or structural check can (semantic quote-to-cell support,
// over-claimed functions, stale descriptions).
//
// Deterministic: the RNG is seeded from the audit month (YYYY-MM, UTC now by
// default, or argv[2] for reruns/tests), so re-running within the same month
// yields the identical sample. Offline on purpose.
//
// Sample of 8: 3 from the newest last_reviewed quartile (recently touched
// entries carry the freshest machine-written claims), 3 from entries carrying
// any origin: agent source (the not-yet-promoted population; falls back to
// uniform picks until that population exists), 2 uniform from the rest.
//
// The closing comment of each month's audit issue records X findings / M cells;
// that series is the catalog's measured error rate.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const PRODUCTS_DIR = resolve(process.cwd(), 'products');
const MONTH = /^\d{4}-\d{2}$/.test(process.argv[2] ?? '')
  ? process.argv[2]
  : new Date().toISOString().slice(0, 7);

// Small string hash (FNV-1a) -> 32-bit seed, then mulberry32 PRNG.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(fnv1a(`aidm-sample-audit-${MONTH}`));
const pick = (arr) => arr.splice(Math.floor(rng() * arr.length), 1)[0];

const entries = [];
for (const slug of readdirSync(PRODUCTS_DIR).sort()) {
  const p = join(PRODUCTS_DIR, slug, 'product.yaml');
  if (!statSync(join(PRODUCTS_DIR, slug)).isDirectory() || !existsSync(p)) continue;
  let d;
  try {
    d = parse(readFileSync(p, 'utf8'));
  } catch {
    continue; // validate.mjs owns parse errors; the audit just skips
  }
  const coverage = Array.isArray(d.matrix_coverage) ? d.matrix_coverage : [];
  const sources = [];
  for (const f of [d.vendor, d.description, d.deployment, d.status, d.compliance_attestations])
    if (f?.source) sources.push(f.source);
  if (d.acquisition?.source) sources.push(d.acquisition.source);
  if (d.renamed_from?.source) sources.push(d.renamed_from.source);
  for (const c of coverage) if (c?.source) sources.push(c.source);
  entries.push({
    slug,
    last_reviewed: String(d.last_reviewed ?? ''),
    cells: coverage.length + (d.compliance_attestations ? 1 : 0),
    hasGovern: coverage.some((c) => Array.isArray(c.functions) && c.functions.includes('govern')),
    hasAgentOrigin: sources.some((s) => s.origin === 'agent'),
  });
}

if (entries.length < 8) {
  console.error(`sample-audit: only ${entries.length} entries found — need at least 8`);
  process.exit(1);
}

// Strata. Picks are without replacement across the whole sample.
const chosen = [];
const takeFrom = (poolFilter, n) => {
  const pool = entries.filter((e) => !chosen.includes(e) && poolFilter(e));
  for (let i = 0; i < n && pool.length; i++) chosen.push(pick(pool));
};
const byNewest = [...entries].sort((a, b) => (a.last_reviewed < b.last_reviewed ? 1 : -1));
const quartile = new Set(byNewest.slice(0, Math.max(8, Math.ceil(entries.length / 4))).map((e) => e.slug));
takeFrom((e) => quartile.has(e.slug), 3);
takeFrom((e) => e.hasAgentOrigin, 3); // agent-origin population; may select < 3 while it is small
takeFrom(() => true, 8 - chosen.length); // uniform fallback + the 2 uniform picks

const totalCells = chosen.reduce((n, e) => n + e.cells, 0);

const out = [];
out.push(`# Monthly accuracy audit, ${MONTH}`);
out.push('');
out.push('For each sampled entry, open `products/<slug>/product.yaml` and the pages it cites.');
out.push('A finding is any checklist item that fails; fix findings via normal PRs referencing');
out.push('this issue. The closing comment records X findings / M cells sampled.');
out.push('');
for (const e of chosen.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
  out.push(`## ${e.slug} (last_reviewed ${e.last_reviewed}, ${e.cells} sourced cell${e.cells === 1 ? '' : 's'})`);
  out.push('- [ ] Every quote opens and appears on the page its source cites');
  out.push('- [ ] Each quote semantically supports its cell (the asset and functions it anchors), not just the product');
  if (e.hasGovern)
    out.push('- [ ] Govern rows pass strict-Govern: the note names a policy, standard, registry-of-record, or compliance-evidence artifact');
  out.push('- [ ] Comparative or efficacy claims cite a non-official tier (press, research, regulatory)');
  out.push('- [ ] The description matches current product reality');
  out.push('');
}
out.push(`Sample: ${chosen.length} entries, ${totalCells} sourced cells. Error rate for this month = confirmed findings / ${totalCells}.`);
console.log(out.join('\n'));
