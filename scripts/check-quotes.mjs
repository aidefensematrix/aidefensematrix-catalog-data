#!/usr/bin/env node
// Verifies that every `source.quote` is a normalized substring of the page its
// `source.url` cites — the claim-to-source anchor, checked against reality.
//
// Classification per quote:
//   VERIFIED     — the quote appears on the fetched page (after normalization).
//   MISMATCH     — the page fetched fine with substantive text, quote absent.
//                  This means "needs human re-verification": either the page
//                  changed since `accessed` (re-quote and bump the date) or the
//                  quote was never on it.
//   UNVERIFIABLE — the page cannot be text-checked from here: bot wall or rate
//                  limit (4xx/5xx), timeout, blocked host, a PDF, or a JS-thin
//                  fetch (under ~500 chars of stripped text). Listed, never failed.
//
// Modes (mirrors check-links.mjs):
//   node scripts/check-quotes.mjs lakera zenity   # slug mode: exits 1 on MISMATCH
//   node scripts/check-quotes.mjs                 # full run: always exits 0,
//                                                 # writes `mismatches` to $GITHUB_OUTPUT
//
// SSRF-guarded like check-links.mjs: manual redirects, up to 3 hops, each hop's
// host re-checked. Normalization is copied from the maintainer quote-backfill
// engine so verification matches how quotes were captured.

import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const PRODUCTS = join(process.cwd(), 'products');
const setOut = (k, v) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__EOF__\n${v}\n__EOF__\n`);
};

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

// --- Normalization (kept byte-identical to the quote capture tooling) --------
function strip(h) {
  h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  h = h.replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&mdash;|&ndash;/g, '-').replace(/&hellip;/g, '...').replace(/&#[0-9]+;/g, ' ');
  return h.replace(/\s+/g, ' ').trim();
}
function asciiClean(s) {
  s = s.replace(/[‘’ʼ′`]/g, "'").replace(/[“”″]/g, '"').replace(/[—–‑−‐]/g, '-').replace(/[   ]/g, ' ').replace(/…/g, '...').replace(/®|™|℠/g, '');
  return s.replace(/\s+/g, ' ').trim();
}
const norm = (s) => asciiClean(s).toLowerCase();
const sp = (s) => s.replace(/\s*-\s*/g, '-');

// --- Collect every quoted source, grouped by URL -----------------------------
const byUrl = new Map(); // url -> [{slug, field, quote}]
function collect(slug, obj, path) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.source && typeof obj.source === 'object' && typeof obj.source.quote === 'string' && typeof obj.source.url === 'string') {
    if (!byUrl.has(obj.source.url)) byUrl.set(obj.source.url, []);
    byUrl.get(obj.source.url).push({ slug, field: path || '(entry)', quote: obj.source.quote });
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'source') continue;
    if (Array.isArray(v)) v.forEach((item, i) => collect(slug, item, path ? `${path}.${k}[${i}]` : `${k}[${i}]`));
    else if (v && typeof v === 'object') collect(slug, v, path ? `${path}.${k}` : k);
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
  try { collect(slug, parse(readFileSync(f, 'utf8')), ''); } catch { /* validate.mjs reports parse errors */ }
}

// --- Guarded fetch: manual redirects, max 3 hops, each host re-checked -------
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THIN = 500; // stripped chars below this = JS-rendered page never delivered content

async function fetchPage(url) {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    let u;
    try { u = new URL(current); } catch { return { kind: 'unverifiable', why: 'invalid URL' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'unverifiable', why: 'non-http' };
    if (isBlockedHost(u.hostname)) return { kind: 'unverifiable', why: 'blocked host' };
    if (u.pathname.toLowerCase().endsWith('.pdf')) return { kind: 'unverifiable', why: 'PDF source' };
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA, accept: 'text/html' } });
    } catch (e) {
      return { kind: 'unverifiable', why: e.name === 'TimeoutError' ? 'timeout' : 'fetch error' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { kind: 'unverifiable', why: `HTTP ${res.status} without location` };
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) return { kind: 'unverifiable', why: `HTTP ${res.status}` };
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/pdf')) return { kind: 'unverifiable', why: 'PDF source' };
    const text = strip(await res.text());
    if (text.length < THIN) return { kind: 'unverifiable', why: `thin fetch (${text.length} chars — JS-rendered?)` };
    return { kind: 'page', text };
  }
  return { kind: 'unverifiable', why: 'too many redirects' };
}

// --- Verify ------------------------------------------------------------------
const verified = [];
const mismatches = [];
const unverifiable = [];
for (const [url, quotes] of byUrl) {
  const page = await fetchPage(url);
  for (const q of quotes) {
    const tag = `${q.slug} ${q.field}`;
    if (page.kind !== 'page') {
      unverifiable.push(`${tag} — ${url} (${page.why})`);
      continue;
    }
    const nq = norm(q.quote);
    const npg = norm(page.text);
    // Trailing sentence punctuation is capture formatting, not claim content: a
    // page sentence that gained a parenthetical still contains the quoted claim.
    const bare = nq.replace(/[.!?]+$/, '');
    const found =
      npg.includes(nq) || sp(npg).includes(sp(nq)) ||
      (bare.length >= 10 && (npg.includes(bare) || sp(npg).includes(sp(bare))));
    if (found) verified.push(tag);
    else mismatches.push(`${tag} — quote not found on ${url}`);
  }
  await sleep(250);
}

console.log(`Quotes checked: ${verified.length + mismatches.length + unverifiable.length} across ${byUrl.size} URL(s) — ${verified.length} verified, ${mismatches.length} mismatch(es), ${unverifiable.length} unverifiable.`);
if (unverifiable.length) console.log(`\nUnverifiable (listed, not failed):\n  ${unverifiable.join('\n  ')}`);
if (mismatches.length) {
  const body = `Quotes needing human re-verification (page changed since accessed, or quote never present):\n- ${mismatches.join('\n- ')}`;
  console.log(`\n${body}`);
  setOut('mismatches', body);
}

// Slug mode gates a publish: a mismatch on an entry being shipped blocks.
// Full-run (cron) mode never blocks; the workflow files an issue instead.
if (only.length && mismatches.length) process.exit(1);
