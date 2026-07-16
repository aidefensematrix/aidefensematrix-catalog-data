#!/usr/bin/env node
// Link check over catalog source/product URLs. SSRF-guarded: refuses
// non-http(s) and private/loopback/link-local/metadata targets, and does NOT
// auto-follow redirects into them (redirect: manual). Read-only, non-blocking;
// writes `dead` to $GITHUB_OUTPUT only for unambiguously-gone links (404/410, or
// a DNS/connection failure). Bot walls and rate limits (401/403/429, 5xx, 400)
// are logged as "unverified" but never reported as dead — see classify() below.

import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const PRODUCTS = join(process.cwd(), 'products');
const setOut = (k, v) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__EOF__\n${v}\n__EOF__\n`);
};

// Block obvious SSRF targets by host. (DNS-rebinding to a private IP is a deeper
// hardening item; tracked in SECURITY.md.)
function isBlockedHost(host) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  // IPv4 literal in private/loopback/link-local ranges
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 0) return true;
  }
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

const urls = new Map(); // url -> Set(slug)
function add(url, slug) {
  if (typeof url !== 'string') return;
  if (!urls.has(url)) urls.set(url, new Set());
  urls.get(url).add(slug);
}
function collect(slug, obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'url' && typeof v === 'string') add(v, slug);
    else collect(slug, v);
  }
}

const dirs = existsSync(PRODUCTS)
  ? readdirSync(PRODUCTS).filter((d) => statSync(join(PRODUCTS, d)).isDirectory())
  : [];
// Optional slug filter: `node scripts/check-links.mjs lakera zenity` checks only
// those entries — handy for verifying the links of entries you just added or edited.
const only = process.argv.slice(2);
const selected = only.length ? dirs.filter((d) => only.includes(d)) : dirs;
const skippedDiscontinued = [];
for (const slug of selected) {
  const f = join(PRODUCTS, slug, 'product.yaml');
  if (!existsSync(f)) continue;
  try {
    const doc = parse(readFileSync(f, 'utf8'));
    // Discontinued products keep their entries as a historical record, so their
    // cited pages are expected to go away; a dead link there is not a data
    // defect. Skip them instead of re-reporting known-gone links.
    if (doc?.status?.value === 'discontinued') { skippedDiscontinued.push(slug); continue; }
    collect(slug, doc);
  } catch { /* validate.mjs reports parse errors */ }
}

// A link check running from a CI datacenter IP can prove a link is GONE (404/410,
// or a DNS/connection failure) but cannot prove a bot-walled link is ALIVE:
// 401/403/429 and 5xx are access, rate-limit, or transient responses, and 400 is
// often a picky CDN rejecting a non-browser request — none mean the page is gone.
// So only unambiguous "gone" signals land in `dead` (which opens an issue);
// everything else is logged as "unverified" and never blocks.
const DEAD_STATUS = new Set([404, 410]);

// Hosts whose pages are client-side rendered apps that serve error statuses
// (including 404) to non-browser HTTP clients even when the page exists. A
// "dead" result here proves nothing, so it is demoted to unverified; confirm
// these in a real browser before treating them as gone.
const BROWSER_ONLY_HOSTS = new Set([
  'developer.salesforce.com',
]);
const LINK_UA = 'aidefensematrix-catalog-linkcheck/1.0';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url, ua, method = 'GET') =>
  fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': ua } });

// Returns null if the link is alive, else { dead } or { unverified } with a line.
async function classify(url, tag) {
  try {
    const head = await get(url, LINK_UA, 'HEAD');
    if (head.status >= 200 && head.status < 400) return null;                  // alive
    if (DEAD_STATUS.has(head.status)) return { dead: `${url} (HTTP ${head.status}) — ${tag}` };
    // 405 / bot wall / rate limit / transient: fall through to a browser-like GET.
  } catch { /* network error on HEAD — fall through to the browser-like GET retry */ }
  try {
    const res = await get(url, BROWSER_UA, 'GET');
    if (res.status >= 200 && res.status < 400) return null;                    // alive
    if (DEAD_STATUS.has(res.status)) return { dead: `${url} (HTTP ${res.status}) — ${tag}` };
    return { unverified: `${url} (HTTP ${res.status}) — ${tag}` };             // bot wall / rate limit / transient
  } catch (e) {
    if (e.name === 'TimeoutError') return { unverified: `${url} (timeout) — ${tag}` };
    return { dead: `${url} (${e.name || 'fetch error'}) — ${tag}` };           // DNS / connection failure
  }
}

const dead = [];
const unverified = [];
const blocked = [];
for (const [url, slugs] of urls) {
  let u;
  try { u = new URL(url); } catch { dead.push(`${url} (invalid URL) — ${[...slugs].join(', ')}`); continue; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { blocked.push(`${url} (non-http)`); continue; }
  if (isBlockedHost(u.hostname)) { blocked.push(`${url} (blocked host)`); continue; }
  const r = await classify(url, [...slugs].join(', '));
  if (r?.dead && BROWSER_ONLY_HOSTS.has(u.hostname)) unverified.push(`${r.dead} [browser-only host]`);
  else if (r?.dead) dead.push(r.dead);
  else if (r?.unverified) unverified.push(r.unverified);
  await sleep(250); // politeness gap; avoids self-inflicted 429s on rate-limited hosts
}

if (skippedDiscontinued.length) console.log(`Skipped ${skippedDiscontinued.length} discontinued entr${skippedDiscontinued.length === 1 ? 'y' : 'ies'}: ${skippedDiscontinued.join(', ')}`);
if (blocked.length) console.log(`Refused ${blocked.length} SSRF-unsafe URL(s):\n  ${blocked.join('\n  ')}`);
if (unverified.length) console.log(`Could not verify ${unverified.length} link(s) — bot wall, rate limit, or transient; not reported as dead:\n  ${unverified.join('\n  ')}`);
if (dead.length) {
  const body = `Dead or unreachable catalog links:\n- ${dead.join('\n- ')}`;
  console.log(body);
  setOut('dead', body);
} else {
  console.log(`All reachable catalog links resolved (${urls.size} checked, ${unverified.length} unverified).`);
}
