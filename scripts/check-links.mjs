#!/usr/bin/env node
// Weekly link check over catalog source/product URLs. SSRF-guarded: refuses
// non-http(s) and private/loopback/link-local/metadata targets, and does NOT
// auto-follow redirects into them (redirect: manual). Read-only, non-blocking;
// writes `dead` to $GITHUB_OUTPUT only when reachable-but-broken links are found.

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
for (const slug of selected) {
  const f = join(PRODUCTS, slug, 'product.yaml');
  if (!existsSync(f)) continue;
  try { collect(slug, parse(readFileSync(f, 'utf8'))); } catch { /* validate.mjs reports parse errors */ }
}

const dead = [];
const blocked = [];
for (const [url, slugs] of urls) {
  let u;
  try { u = new URL(url); } catch { dead.push(`${url} (invalid URL) — ${[...slugs].join(', ')}`); continue; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { blocked.push(`${url} (non-http)`); continue; }
  if (isBlockedHost(u.hostname)) { blocked.push(`${url} (blocked host)`); continue; }
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'aidefensematrix-catalog-linkcheck/1.0' } });
    // Some hosts (npm, bot-walled CDNs) reject HEAD with 403/405 while GET works;
    // retry those with GET before declaring the link dead.
    if (res.status === 403 || res.status === 405) {
      res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'aidefensematrix-catalog-linkcheck/1.0' } });
    }
    // 2xx and 3xx (redirect, not auto-followed) are considered alive.
    if (res.status >= 400) dead.push(`${url} (HTTP ${res.status}) — ${[...slugs].join(', ')}`);
  } catch (e) {
    // Some docs hosts stall connections from non-browser user agents (observed on
    // docs.fortinet.com). Retry once with a browser-like UA before declaring death.
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } });
      if (res.status >= 400) dead.push(`${url} (HTTP ${res.status}) — ${[...slugs].join(', ')}`);
    } catch {
      dead.push(`${url} (${e.name === 'TimeoutError' ? 'timeout' : 'fetch error'}) — ${[...slugs].join(', ')}`);
    }
  }
}

if (blocked.length) console.log(`Refused ${blocked.length} SSRF-unsafe URL(s):\n  ${blocked.join('\n  ')}`);
if (dead.length) {
  const body = `Dead or unreachable catalog links:\n- ${dead.join('\n- ')}`;
  console.log(body);
  setOut('dead', body);
} else {
  console.log(`All ${urls.size} catalog links resolved.`);
}
