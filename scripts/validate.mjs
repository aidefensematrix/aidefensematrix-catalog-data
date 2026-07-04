#!/usr/bin/env node
// Cross-file structure, sourcing, and quality checks for the catalog data. Writes a
// plain-English summary to $GITHUB_STEP_SUMMARY so a PR author can self-correct before
// review. Exits non-zero on any ERROR. Run it locally with `pnpm validate`.
//
// Bounded regexes over length-capped fields keep this ReDoS-safe. It does no network
// I/O on purpose: link-checking runs as a separate scheduled job, so PR CI stays
// offline and fork-safe.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = process.cwd();
// Products dir: an optional argument (relative to CWD), else ./products. Lets this
// run standalone (`node scripts/validate.mjs products`) or from a consumer that
// mounts this repo elsewhere (`node data/scripts/validate.mjs data/products`).
const PRODUCTS_DIR = resolve(ROOT, process.argv[2] ?? 'products');
const SCHEMA_VERSION = 2;

// Canonical AI Defense Matrix ids (this repo is the source of truth; matrix-drift.yml
// watches them against the companion). Loaded relative to this script so it resolves
// whether the repo is standalone or mounted as a submodule.
const IDS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'matrix-ids.json'), 'utf8'),
);
const ASSET_IDS = new Set(IDS.asset_ids);
const FUNCTION_IDS = new Set(IDS.function_ids);

const errors = [];
const warnings = [];
// Slugs that headline Govern (primary_cell.function === 'govern'). Govern is
// rarely a vendor-primary cell, so these are listed for periodic confirmation —
// informational only, never a build failure.
const governHeadlines = [];
const err = (slug, msg) => errors.push(`${slug}: ${msg}`);
const warn = (slug, msg) => warnings.push(`${slug}: ${msg}`);

const kebab = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const STANDARDS = /^(NIST|ISO\s*42001|SSDF|OWASP|MITRE\s+ATLAS)\b/i;
// Marketing superlatives must not appear as fact (description, coverage notes) or
// inside a [confirmed] analysis claim. Vendor marketing is the weakest source, and
// "the first / only / best / most novel" are positioning claims, not verifiable
// details. (User directive.) The "most" pattern is scoped to marketing adjectives so
// ordinary prose like "the most likely outcome" is not flagged.
const SUPERLATIVE_PATTERNS = [
  /\b(industry[-\s]leading|best[-\s]in[-\s]class|market[-\s]leading|world[-\s]class|revolutionary|cutting[-\s]edge|next[-\s]generation|#1)\b/i,
  /\bthe\s+(first|only|best|fastest|largest|leading)\b/i,
  /\bthe\s+most\s+(comprehensive|advanced|innovative|novel|powerful|complete|secure|scalable|robust|sophisticated|accurate|effective|trusted)\b/i,
  /\b(world|industry|market)['’]?s\s+(first|only|best|leading|largest)\b/i,
];
const hasSuperlative = (s) => typeof s === 'string' && SUPERLATIVE_PATTERNS.some((re) => re.test(s));
// Cheap stored-XSS gate (defense-in-depth, mirrors the schema's freeText guard):
// no "<" or ">" in any human-authored free-text field. These feed rendered prose
// and the compare-page JSON data island, so an angle bracket has no legitimate use.
const ANGLE_BRACKETS = /[<>]/;
function checkNoAngleBrackets(slug, where, text) {
  if (typeof text === 'string' && ANGLE_BRACKETS.test(text)) {
    err(slug, `${where} must not contain angle brackets ("<" or ">") — they are not allowed in free text`);
  }
}
// Length parity with the site's Zod schema (src/content.config.ts freeText caps).
// The site build is the authoritative gate; mirroring its caps here means a PR
// cannot pass this validator yet fail the build over a field length.
function checkLen(slug, where, text, min, max) {
  if (typeof text !== 'string') return;
  if (text.length < min || text.length > max)
    err(slug, `${where} must be ${min}-${max} characters (is ${text.length}); the site schema enforces this`);
}
const STUB = /pending maintainer review|^TODO|\bTODO\b/i;
const ORIGINS = new Set(['seeded', 'reviewed', 'auto', 'agent']);

const todayUTC = () => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};
const TODAY = todayUTC();
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const asUTCDate = (v) => {
  // YAML may give a Date (js-yaml timestamp) or a string.
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

function checkDate(slug, label, v, { reviewWindow = false } = {}) {
  const t = asUTCDate(v);
  if (t === null) {
    err(slug, `${label} is not a valid date: ${v}`);
    return;
  }
  if (t > TODAY) err(slug, `${label} is in the future: ${v}`);
  if (reviewWindow && TODAY - t > YEAR_MS) warn(slug, `${label} is over 365 days old: ${v}`);
}

function checkSource(slug, label, source) {
  if (!source || typeof source !== 'object') {
    err(slug, `${label} is missing its source`);
    return;
  }
  if (!source.url || !/^https?:\/\//i.test(String(source.url))) {
    err(slug, `${label} source.url must be http(s): ${source.url}`);
  }
  if (!source.accessed) err(slug, `${label} source is missing an accessed date`);
  else checkDate(slug, `${label} source.accessed`, source.accessed);
  if (source.title !== undefined) checkLen(slug, `${label} source.title`, source.title, 2, 160);
  // Optional verbatim supporting line (claim-to-source audit trail). Length parity
  // with the site schema's freeText(10, 300); angle-bracket gate like other prose.
  if (source.quote !== undefined) {
    checkLen(slug, `${label} source.quote`, source.quote, 10, 300);
    checkNoAngleBrackets(slug, `${label} source.quote`, source.quote);
  }
  const extraKeys = Object.keys(source).filter((k) => !['url', 'tier', 'title', 'accessed', 'origin', 'quote'].includes(k));
  if (extraKeys.length)
    err(slug, `${label} source has unexpected keys (${extraKeys.join(', ')}) — likely an unquoted comma in the title; wrap the value in quotes`);
  // Provenance lock. Origin is mandatory and explicit so the review state of every
  // value is always recorded; the site schema's default('reviewed') stays as a
  // belt-and-braces fallback, but data merged here must state it. `reviewed` means
  // a human verified the value; `agent` means an automated contributor verified it
  // and a maintainer has not yet promoted it to `reviewed`.
  if (source.origin === undefined)
    err(slug, `${label} source is missing origin — set seeded, reviewed, auto, or agent`);
  else if (!ORIGINS.has(source.origin))
    err(slug, `${label} source.origin must be seeded, reviewed, auto, or agent (got "${source.origin}")`);
}

function checkSourced(slug, label, field) {
  if (!field || typeof field !== 'object' || !('value' in field)) {
    err(slug, `${label} must be a { value, source } object`);
    return;
  }
  checkSource(slug, label, field.source);
  // A verified value (human- or agent-verified) should be real, not a seed stub.
  if ((field.source?.origin === 'reviewed' || field.source?.origin === 'agent') && typeof field.value === 'string' && STUB.test(field.value))
    warn(slug, `${label} is origin: ${field.source.origin} but its value is still a stub — verify it or set origin: seeded`);
}

const productDirs = existsSync(PRODUCTS_DIR)
  ? readdirSync(PRODUCTS_DIR).filter((d) => statSync(join(PRODUCTS_DIR, d)).isDirectory())
  : [];

const seenSlugs = new Set(productDirs);
const urlKeys = new Map(); // host+path -> slug

for (const slug of productDirs) {
  const dir = join(PRODUCTS_DIR, slug);
  const files = readdirSync(dir);

  // Security: no MDX (executes JS at build).
  for (const f of files) {
    if (f.endsWith('.mdx')) err(slug, `MDX is not allowed (executes code at build): ${f}`);
  }

  const productPath = join(dir, 'product.yaml');
  if (!existsSync(productPath)) {
    err(slug, 'missing product.yaml');
    continue;
  }

  let p;
  try {
    p = parse(readFileSync(productPath, 'utf8'), { uniqueKeys: true });
  } catch (e) {
    err(slug, `product.yaml failed to parse: ${e.message}`);
    continue;
  }

  if (p.schema_version !== SCHEMA_VERSION) err(slug, `schema_version must be ${SCHEMA_VERSION}`);
  if (typeof p.name === 'string') {
    if (kebab(p.name) !== slug)
      err(slug, `directory must equal kebab-case of name ("${kebab(p.name)}")`);
    if (STANDARDS.test(p.name)) err(slug, 'standards/frameworks are not products');
  }

  // URL uniqueness (host+path)
  try {
    const u = new URL(p.url);
    const key = (u.host + u.pathname).replace(/\/$/, '');
    if (urlKeys.has(key)) err(slug, `shares a URL with "${urlKeys.get(key)}": ${key}`);
    else urlKeys.set(key, slug);
  } catch {
    err(slug, `invalid url: ${p.url}`);
  }

  checkSourced(slug, 'vendor', p.vendor);
  checkSourced(slug, 'description', p.description);
  checkSourced(slug, 'deployment', p.deployment);
  checkSourced(slug, 'status', p.status);

  // Compliance attestations (optional). checkSourced confirms { value, source };
  // each listed attestation also runs the angle-bracket gate.
  if (p.compliance_attestations) {
    checkSourced(slug, 'compliance_attestations', p.compliance_attestations);
    // Warn-only (never blocks a PR): a quote is the claim-to-source anchor for the
    // attestation list — the line on the cited page that names these certifications.
    if (p.compliance_attestations.source && p.compliance_attestations.source.quote === undefined)
      warn(slug, 'compliance_attestations source has no quote — add the line on the cited page that lists these attestations');
    checkNoAngleBrackets(slug, 'compliance_attestations source.title', p.compliance_attestations.source?.title);
    if (Array.isArray(p.compliance_attestations.value))
      p.compliance_attestations.value.forEach((a, i) => {
        checkNoAngleBrackets(slug, `compliance_attestations[${i}]`, a);
      });
  }

  if (p.last_reviewed) checkDate(slug, 'last_reviewed', p.last_reviewed, { reviewWindow: true });

  if (typeof p.description?.value === 'string') {
    const len = p.description.value.length;
    if (len < 20 || len > 200) err(slug, `description.value must be 20-200 characters (is ${len})`);
  }
  if (hasSuperlative(p.description?.value))
    err(slug, 'description contains a marketing superlative presented as fact');
  if (p.description?.value && STUB.test(p.description.value))
    warn(slug, 'description is a seed stub; replace with a sourced one-liner');

  // Free-text length parity with the site schema (titles are covered in checkSource).
  checkLen(slug, 'name', p.name, 2, 80);
  checkLen(slug, 'vendor.value', p.vendor?.value, 2, 80);
  if (Array.isArray(p.aliases)) {
    if (p.aliases.length > 20) err(slug, `aliases has ${p.aliases.length} entries; the site schema caps it at 20`);
    p.aliases.forEach((a, i) => checkLen(slug, `aliases[${i}]`, a, 2, 80));
  }
  if (Array.isArray(p.compliance_attestations?.value)) {
    if (p.compliance_attestations.value.length > 15)
      err(slug, `compliance_attestations lists ${p.compliance_attestations.value.length} items; the site schema caps it at 15`);
    p.compliance_attestations.value.forEach((a, i) => checkLen(slug, `compliance_attestations[${i}]`, a, 2, 60));
  }
  if (p.acquisition) {
    checkLen(slug, 'acquisition.acquirer', p.acquisition.acquirer, 2, 80);
    checkLen(slug, 'acquisition.new_name', p.acquisition.new_name, 0, 80);
  }
  if (p.renamed_from) checkLen(slug, 'renamed_from.name', p.renamed_from.name, 2, 80);
  if (p.vendor_response?.text) checkLen(slug, 'vendor_response.text', p.vendor_response.text, 10, 1500);
  if (Array.isArray(p.changelog)) {
    if (p.changelog.length > 200) err(slug, `changelog has ${p.changelog.length} entries; the site schema caps it at 200`);
    p.changelog.forEach((c, i) => checkLen(slug, `changelog[${i}].summary`, c?.summary, 5, 300));
  }

  // Free-text angle-bracket gate (mirrors the schema's freeText guard).
  checkNoAngleBrackets(slug, 'name', p.name);
  checkNoAngleBrackets(slug, 'vendor.value', p.vendor?.value);
  checkNoAngleBrackets(slug, 'vendor source.title', p.vendor?.source?.title);
  if (Array.isArray(p.aliases))
    p.aliases.forEach((a, i) => checkNoAngleBrackets(slug, `aliases[${i}]`, a));
  checkNoAngleBrackets(slug, 'description.value', p.description?.value);
  checkNoAngleBrackets(slug, 'description source.title', p.description?.source?.title);
  checkNoAngleBrackets(slug, 'deployment source.title', p.deployment?.source?.title);
  checkNoAngleBrackets(slug, 'status source.title', p.status?.source?.title);
  if (p.acquisition) {
    checkNoAngleBrackets(slug, 'acquisition.acquirer', p.acquisition.acquirer);
    checkNoAngleBrackets(slug, 'acquisition.new_name', p.acquisition.new_name);
    checkNoAngleBrackets(slug, 'acquisition source.title', p.acquisition.source?.title);
  }
  if (p.renamed_from) {
    checkNoAngleBrackets(slug, 'renamed_from.name', p.renamed_from.name);
    checkNoAngleBrackets(slug, 'renamed_from source.title', p.renamed_from.source?.title);
  }
  if (p.vendor_response?.text)
    checkNoAngleBrackets(slug, 'vendor_response.text', p.vendor_response.text);
  if (Array.isArray(p.changelog))
    p.changelog.forEach((c, i) => checkNoAngleBrackets(slug, `changelog[${i}].summary`, c?.summary));

  // Acquisition consistency + citation
  const status = p.status?.value;
  if ((status === 'acquired' || status === 'merged') !== Boolean(p.acquisition))
    err(slug, 'acquisition block is required iff status is acquired/merged');
  if (p.acquisition) {
    checkSource(slug, 'acquisition', p.acquisition.source);
    if (p.acquisition.acquirer_slug && !seenSlugs.has(p.acquisition.acquirer_slug))
      warn(slug, `acquirer_slug "${p.acquisition.acquirer_slug}" has no catalog entry`);
    // pending_close marks an announced deal that has not closed; it is removed
    // (with a changelog entry) once the close is confirmed. Most deals resolve
    // within a year, so a long-lived flag is probably stale.
    if (p.acquisition.pending_close !== undefined && typeof p.acquisition.pending_close !== 'boolean')
      err(slug, 'acquisition.pending_close must be a boolean when present');
    if (p.acquisition.pending_close === true) {
      const t = asUTCDate(p.acquisition.announced);
      if (t !== null && TODAY - t > YEAR_MS)
        warn(slug, 'acquisition is still pending_close over a year after the announcement — re-verify whether the deal closed');
    }
  }
  if (p.renamed_from) {
    checkSource(slug, 'renamed_from', p.renamed_from.source);
    checkDate(slug, 'renamed_from.date', p.renamed_from.date);
  }

  // Coverage: sources, known ids, and quality.
  if (Array.isArray(p.matrix_coverage)) {
    p.matrix_coverage.forEach((c, i) => {
      checkSource(slug, `matrix_coverage[${i}]`, c.source);
      // Warn-only (never blocks a PR): the quote anchors WHY this cell is claimed —
      // the sentence on the page that shows the capability. It is the burden-of-
      // evidence a reviewer uses to adjudicate the asset/function mapping.
      if (c.source && c.source.quote === undefined)
        warn(slug, `matrix_coverage[${i}] source has no quote — add the line on the cited page that supports this asset/function mapping`);
      checkNoAngleBrackets(slug, `matrix_coverage[${i}].note`, c.note);
      checkNoAngleBrackets(slug, `matrix_coverage[${i}] source.title`, c.source?.title);
      if (hasSuperlative(c.note)) err(slug, `matrix_coverage[${i}].note contains a marketing superlative`);
      if (c.note !== undefined) checkLen(slug, `matrix_coverage[${i}].note`, c.note, 3, 300);
      // Govern is the most over-claimed function. A govern cell must name its
      // governance artifact (policy, registry of record, compliance evidence,
      // a standard) in the note, or it reads as the "secures AI ⇒ governance"
      // overreach. Soft warning: discovery is identify, enforcement is protect.
      if (Array.isArray(c.functions) && c.functions.includes('govern') && (c.note === undefined || String(c.note).trim() === ''))
        warn(slug, `matrix_coverage[${i}] claims Govern without a note. Name the governance artifact (policy, registry of record, compliance evidence, standard) per CONTRIBUTING "Function assignment"`);
      if (c.maturity && !['primary', 'secondary', 'adjacent'].includes(c.maturity))
        err(slug, `matrix_coverage[${i}].maturity must be primary, secondary, or adjacent (got "${c.maturity}")`);
      if (c.asset !== undefined && !ASSET_IDS.has(c.asset))
        err(slug, `matrix_coverage[${i}].asset is not a known asset id: "${c.asset}"`);
      if (Array.isArray(c.functions))
        c.functions.forEach((fn, j) => {
          if (!FUNCTION_IDS.has(fn))
            err(slug, `matrix_coverage[${i}].functions[${j}] is not a known CSF function id: "${fn}"`);
        });
    });
  }

  // primary_cell (optional) must name known ids.
  if (p.primary_cell) {
    if (!ASSET_IDS.has(p.primary_cell.asset))
      err(slug, `primary_cell.asset is not a known asset id: "${p.primary_cell.asset}"`);
    if (!FUNCTION_IDS.has(p.primary_cell.function))
      err(slug, `primary_cell.function is not a known CSF function id: "${p.primary_cell.function}"`);
    if (p.primary_cell.function === 'govern') governHeadlines.push(slug);
  }

  // Changelog chronology
  if (Array.isArray(p.changelog)) {
    let prev = -Infinity;
    for (const c of p.changelog) {
      checkDate(slug, 'changelog entry', c.date);
      const t = asUTCDate(c.date);
      if (t !== null && t < prev) warn(slug, 'changelog entries are not in chronological order');
      if (t !== null) prev = t;
    }
  }

  // Origin consistency: once an entry is being enriched (any source is reviewed),
  // flag sibling sources still marked seeded — a half-finished enrichment. A pure
  // seed stub (all seeded) does not warn; a fully reviewed entry has none seeded.
  const originPairs = [];
  for (const [lbl, f] of [
    ['vendor', p.vendor],
    ['description', p.description],
    ['deployment', p.deployment],
    ['status', p.status],
    ['compliance_attestations', p.compliance_attestations],
  ])
    if (f && typeof f === 'object' && f.source) originPairs.push([lbl, f.source]);
  if (p.acquisition?.source) originPairs.push(['acquisition', p.acquisition.source]);
  if (p.renamed_from?.source) originPairs.push(['renamed_from', p.renamed_from.source]);
  if (Array.isArray(p.matrix_coverage))
    p.matrix_coverage.forEach((c, i) => {
      if (c?.source) originPairs.push([`matrix_coverage[${i}]`, c.source]);
    });
  if (originPairs.some(([, s]) => s.origin === 'reviewed' || s.origin === 'agent'))
    for (const [lbl, s] of originPairs)
      if (s.origin === 'seeded')
        warn(slug, `${lbl} is still origin: seeded on an otherwise-verified entry — verify it (agent or reviewed) or leave the entry a pure stub`);

}

// ---- Report -----------------------------------------------------------------
const lines = [];
lines.push(`# Catalog validation`);
lines.push('');
lines.push(`Checked ${productDirs.length} product director${productDirs.length === 1 ? 'y' : 'ies'}.`);
lines.push('');
if (errors.length) {
  lines.push(`## ❌ ${errors.length} error(s)`);
  for (const e of errors) lines.push(`- ${e}`);
  lines.push('');
}
if (warnings.length) {
  lines.push(`## ⚠️ ${warnings.length} warning(s)`);
  for (const w of warnings) lines.push(`- ${w}`);
  lines.push('');
}
// Informational only (does not affect pass/fail). Govern is rarely a vendor-primary
// cell, so the entries that headline it are listed for periodic confirmation.
if (governHeadlines.length) {
  lines.push(`## ℹ️ Govern headlines (${governHeadlines.length})`);
  lines.push(
    'Govern is rarely a vendor-primary cell. Confirm each headlines Govern because it is a purpose-built governance, AI-TRiSM, or data-and-AI-catalog platform a buyer would choose instead of consultants (see CONTRIBUTING "Function assignment"):',
  );
  for (const s of governHeadlines) lines.push(`- ${s}`);
  lines.push('');
}
if (!errors.length && !warnings.length) lines.push('All checks passed. ✅');

const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  } catch {
    /* non-fatal */
  }
}

process.exit(errors.length ? 1 : 0);
