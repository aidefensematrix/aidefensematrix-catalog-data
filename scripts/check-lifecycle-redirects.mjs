#!/usr/bin/env node
// Lifecycle-drift guard. The quote check (check-quotes.mjs) only notices a rebrand or
// acquisition when a cited quote stops matching; a redirect on a non-quoted URL, or a
// rebrand whose quote still matches, is invisible to it. This check probes the
// load-bearing URLs of every active entry for three orthogonal tells that a vendor's
// lifecycle may have changed since the entry was last reviewed:
//
//   CROSS-DOMAIN — a load-bearing URL now redirects to a different registrable domain
//                  (a common rebrand / acquisition / domain-move tell).
//   DEAD         — HTTP 404/410 on a cited page (the vendor restructured or removed it).
//   PHRASE       — acquisition / rebrand language on the vendor's own page.
//
// It is a signal, not a verdict: every hit needs a human to confirm with a dated primary
// source and classify it (acquired / merged / renamed-while-active / discontinued /
// false alarm). Known false-positive classes it cannot filter: a vendor page announcing
// that the vendor ITSELF acquired someone else, and a founder bio naming a past exit.
//
// SSRF-guarded like check-links.mjs: manual redirects, up to 3 hops, each hop's host
// re-checked. Fetch semantics mirror check-quotes.mjs so the redirects seen here match.
//
// Modes (mirror check-quotes.mjs / check-links.mjs):
//   node scripts/check-lifecycle-redirects.mjs             # full run: always exits 0,
//                                                          # writes `lifecycle` to $GITHUB_OUTPUT
//   node scripts/check-lifecycle-redirects.mjs astrix zenity  # slug mode: exits 1 on a hit

import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const PRODUCTS = join(process.cwd(), 'products');
const setOut = (k, v) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__EOF__\n${v}\n__EOF__\n`);
};

// SSRF host guard (identical policy to check-links.mjs / check-quotes.mjs).
function isBlockedHost(host) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 0) return true;
  }
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

// eTLD+1 comparison, with a heuristic multi-part public-suffix set so a www<->apex or a
// path-only redirect is not mistaken for a domain change. This is a common-case subset,
// not the full Public Suffix List (kept dependency-free on purpose); an exotic ccTLD move
// (e.g. foo.com.au -> foo.au) may mis-compare, which only ever means a signal a human
// then dismisses or a rare miss — acceptable for a triage aid.
const MULTI = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'com.cn', 'com.hk', 'com.tw', 'co.in', 'co.id', 'co.th', 'com.sg', 'com.my',
  'com.br', 'com.mx', 'co.nz', 'co.za', 'co.il', 'com.tr', 'com.ua',
]);
function regDomain(host) {
  host = (host || '').toLowerCase().replace(/\.$/, '');
  const p = host.split('.');
  if (p.length <= 2) return host;
  const last2 = p.slice(-2).join('.');
  if (MULTI.has(last2) && p.length >= 3) return p.slice(-3).join('.');
  return last2;
}

function strip(h) {
  h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  h = h.replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&mdash;|&ndash;/g, '-').replace(/&hellip;/g, '...').replace(/&#[0-9]+;/g, ' ');
  return h.replace(/\s+/g, ' ').trim();
}

// --- Collect load-bearing URLs on active (or status-missing) entries ----------
// url -> { slugs:Set, labels:Set, ownVendorPage:bool, lifecycleKnown:bool }.
// ownVendorPage marks the vendor's own official page (top-level url, or an
// official-tier vendor/description source) — phrase scanning is limited to these to
// avoid press-page sidebar noise. lifecycleKnown is true when a citing entry already
// records a rename or acquisition (renamed_from / acquisition), so its own page saying
// "is now X" / "part of Y" is the change we already captured, not a fresh signal.
const byUrl = new Map();
function note(url, slug, label, ownVendorPage, lifecycleKnown) {
  if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
  if (!byUrl.has(url)) byUrl.set(url, { slugs: new Set(), labels: new Set(), ownVendorPage: false, lifecycleKnown: false });
  const e = byUrl.get(url);
  e.slugs.add(slug);
  e.labels.add(label);
  if (ownVendorPage) e.ownVendorPage = true;
  if (lifecycleKnown) e.lifecycleKnown = true;
}

function collect(slug, doc) {
  const status = doc.status?.value ?? doc.status;
  if (status && status !== 'active') return; // only active or status-missing entries
  const known = Boolean(doc.renamed_from || doc.acquisition);
  note(doc.url, slug, 'url', true, known);
  const isOfficial = (s) => s && s.tier === 'official';
  note(doc.vendor?.source?.url, slug, 'vendor', isOfficial(doc.vendor?.source), known);
  note(doc.description?.source?.url, slug, 'description', isOfficial(doc.description?.source), known);
  note(doc.status?.source?.url, slug, 'status', false, known); // status sources are often press — no phrase scan
  const pc = doc.primary_cell;
  if (pc && Array.isArray(doc.matrix_coverage)) {
    const row = doc.matrix_coverage.find((r) => r.asset === pc.asset && Array.isArray(r.functions) && r.functions.includes(pc.function));
    if (row?.source?.url) note(row.source.url, slug, 'primary_cell', isOfficial(row.source), known);
  }
}

const dirs = existsSync(PRODUCTS)
  ? readdirSync(PRODUCTS).filter((d) => statSync(join(PRODUCTS, d)).isDirectory())
  : [];
const only = process.argv.slice(2);
const selected = only.length ? dirs.filter((d) => only.includes(d)) : dirs;
for (const slug of selected) {
  const f = join(PRODUCTS, slug, 'product.yaml');
  if (!existsSync(f)) continue;
  try { collect(slug, parse(readFileSync(f, 'utf8'))); } catch { /* validate.mjs reports parse errors */ }
}

// --- Guarded fetch: manual redirects, max 3 hops, records the final URL --------
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const THIN = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    let u;
    try { u = new URL(current); } catch { return { kind: 'skip', why: 'invalid URL', final: current }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'skip', why: 'non-http', final: current };
    if (isBlockedHost(u.hostname)) return { kind: 'skip', why: 'blocked host', final: current };
    if (u.pathname.toLowerCase().endsWith('.pdf')) return { kind: 'skip', why: 'PDF', final: current };
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA, accept: 'text/html' } });
    } catch (e) {
      return { kind: 'skip', why: e.name === 'TimeoutError' ? 'timeout' : 'fetch error', final: current };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { kind: 'skip', why: `HTTP ${res.status} without location`, final: current };
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 404 || res.status === 410) return { kind: 'dead', status: res.status, final: current };
    if (res.status < 200 || res.status >= 300) return { kind: 'skip', why: `HTTP ${res.status}`, final: current };
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/pdf')) return { kind: 'skip', why: 'PDF', final: current };
    const text = strip(await res.text());
    if (text.length < THIN) return { kind: 'skip', why: `thin (${text.length} chars — JS-rendered?)`, final: current };
    return { kind: 'page', text, final: current };
  }
  return { kind: 'skip', why: 'too many redirects', final: current };
}

// --- Acquisition / rebrand phrases (scanned only on the vendor's own pages) ----
const PHRASES = ['is now part of', 'acquired by', 'has acquired', 'has joined', 'now part of', 'has been acquired', 'joins forces'];
// Benign leading words after "is now ..." that are NOT a rebrand (marketing copy). Matched
// case-insensitively against the captured phrase's first word, since the source text is
// title-cased ("is now Generally Available") and a lowercase-only lookahead would miss it.
const REBRAND_STOP = new Set(['available', 'the', 'a', 'an', 'in', 'part', 'live', 'open', 'free', 'generally', 'here', 'ready', 'faster', 'better', 'coming', 'smarter', 'easier']);
function phraseHit(text) {
  const low = text.toLowerCase();
  for (const p of PHRASES) {
    const i = low.indexOf(p);
    if (i >= 0) return { phrase: p, window: text.slice(Math.max(0, i - 50), i + p.length + 70).replace(/\s+/g, ' ').trim() };
  }
  // "is now <Capitalized>" rebrand pattern; drop it when the captured phrase starts with a
  // benign marketing word (checked in-code, case-insensitively — see REBRAND_STOP above).
  const m = text.match(/\bis now ([A-Z][\w&.-]+(?: [A-Z][\w&.-]+){0,3})/);
  if (m && !REBRAND_STOP.has(m[1].split(/[\s-]/)[0].toLowerCase()))
    return { phrase: `is now ${m[1]}`, window: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 50).replace(/\s+/g, ' ').trim() };
  return null;
}

// --- Probe ---------------------------------------------------------------------
const flags = [];
const skipped = [];
for (const [url, meta] of byUrl) {
  const who = `${[...meta.slugs].sort().join(', ')} (${[...meta.labels].sort().join('/')})`;
  let citedDom;
  try { citedDom = regDomain(new URL(url).hostname); } catch { skipped.push(`${url} (invalid URL) — ${who}`); continue; }
  const r = await fetchPage(url);
  // The cross-domain tell is proven by the redirect hops themselves, so evaluate it for
  // EVERY outcome that produced a final URL — even a dead or JS-thin destination (an
  // acquirer's client-rendered landing page must not silence a real domain move). Suppress
  // it, like the phrase scan, when the entry already records the rename/acquisition.
  let finalDom = citedDom;
  try { if (r.final) finalDom = regDomain(new URL(r.final).hostname); } catch { finalDom = citedDom; }
  const crossDomain = finalDom !== citedDom && !meta.lifecycleKnown;
  if (crossDomain)
    flags.push(`- ${who}: ${url} now redirects to ${r.final} (${citedDom} -> ${finalDom}); possible rebrand, domain move, or acquisition — confirm and update.`);
  if (r.kind === 'dead') {
    flags.push(`- ${who}: ${url} returns HTTP ${r.status}; the vendor removed or moved the page — re-point the citation or review status.`);
  } else if (r.kind === 'page') {
    // Phrase-scan only the vendor's own pages, and only when the entry has not already
    // recorded a rename/acquisition (else we re-flag the change we already captured).
    if (meta.ownVendorPage && !meta.lifecycleKnown) {
      const ph = phraseHit(r.text);
      if (ph) flags.push(`- ${who}: ${url} reads "${ph.phrase}" (...${ph.window}...); confirm whether the product was acquired or renamed.`);
    }
  } else if (!crossDomain) {
    skipped.push(`${url} (${r.why}) — ${who}`); // unchecked and no domain-move signal to report
  }
  await sleep(200); // politeness gap
}

if (skipped.length)
  console.log(`Could not check ${skipped.length} URL(s) — bot wall, rate limit, PDF, or JS-rendered; not a signal:\n  ${skipped.join('\n  ')}`);

if (flags.length) {
  const body = [
    'A catalog entry may have a stale lifecycle status (see GOVERNANCE "Product lifecycle and acquisitions"). Each item needs a dated primary source to confirm and classify:',
    ...flags,
    '',
    'Source: redirect, HTTP status, and on-page language of the entries\' load-bearing URLs.',
  ].join('\n');
  console.log(body);
  setOut('lifecycle', body);
} else {
  console.log(`No lifecycle-drift signals across ${byUrl.size} load-bearing URL(s) (${skipped.length} unchecked).`);
}

// Slug mode gates a publish: a hit on an entry being shipped blocks. Full run never blocks.
if (only.length && flags.length) process.exit(1);
