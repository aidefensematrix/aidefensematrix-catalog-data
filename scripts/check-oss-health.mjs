#!/usr/bin/env node
// Weekly health guard for open-source entries: every GitHub repository cited in the
// catalog (the top-level `url` or any `source.url`, root form only) should still
// exist, live at the cited org/repo, not be archived, and show recent activity.
// Read-only, tolerant of API outages and rate limits (those skip, never report).
// Writes `health` to $GITHUB_OUTPUT only when a repository needs a human look.

import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const PRODUCTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'products');
// A repository with no pushes for this long is probably unmaintained; the issue is
// an early warning for the (roughly eighteen-month) GOVERNANCE review threshold.
const MAX_IDLE_DAYS = Number(process.env.OSS_HEALTH_MAX_IDLE_DAYS) || 365;
const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/;

const setOut = (k, v) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__EOF__\n${v}\n__EOF__\n`);
};

// Collect every cited URL in an entry: the top-level url plus each source.url.
const collectUrls = (node, urls) => {
  if (Array.isArray(node)) { node.forEach((n) => collectUrls(n, urls)); return; }
  if (node && typeof node === 'object') {
    if (typeof node.url === 'string') urls.push(node.url);
    Object.values(node).forEach((v) => collectUrls(v, urls));
  }
};

// org/repo (as cited) -> Set of slugs citing it
const repos = new Map();
for (const dirent of readdirSync(PRODUCTS_DIR, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  let doc;
  try {
    doc = parse(readFileSync(join(PRODUCTS_DIR, dirent.name, 'product.yaml'), 'utf8'));
  } catch {
    continue; // the validator owns YAML errors
  }
  const urls = [];
  collectUrls(doc, urls);
  for (const url of urls) {
    const m = REPO_RE.exec(url);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}`;
    if (!repos.has(key)) repos.set(key, new Set());
    repos.get(key).add(dirent.name);
  }
}

if (repos.size === 0) {
  console.log('No GitHub repositories are cited in the catalog.');
  process.exit(0);
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'aidefensematrix-catalog-data',
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const flags = [];
for (const [orgRepo, slugSet] of repos) {
  const slugs = [...slugSet].sort().join(', ');
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${orgRepo}`, {
      headers,
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
  } catch (e) {
    console.log(`${orgRepo}: GitHub API not reachable (${e.message}); skipping.`);
    continue;
  }
  if (res.status === 404) {
    flags.push(`- ${slugs}: ${orgRepo} was not found on GitHub (moved or deleted); update or replace the citation.`);
    continue;
  }
  if (!res.ok) {
    console.log(`${orgRepo}: GitHub API returned HTTP ${res.status}; skipping.`);
    continue;
  }
  const repo = await res.json();
  if (repo.full_name && repo.full_name.toLowerCase() !== orgRepo.toLowerCase())
    flags.push(`- ${slugs}: ${orgRepo} has moved to ${repo.full_name}; update the cited URLs.`);
  if (repo.archived === true)
    flags.push(`- ${slugs}: ${orgRepo} is archived; review the entry status per GOVERNANCE.`);
  const pushed = Date.parse(repo.pushed_at);
  if (Number.isFinite(pushed) && Date.now() - pushed > MAX_IDLE_DAYS * 24 * 60 * 60 * 1000)
    flags.push(`- ${slugs}: ${orgRepo} has had no pushes since ${repo.pushed_at.slice(0, 10)}; review the entry status per GOVERNANCE.`);
}

if (flags.length) {
  const body = [
    'A cited GitHub repository needs a maintainer look (see GOVERNANCE "Open-source project health").',
    ...flags,
    '',
    'Source: the GitHub repositories API, checked weekly.',
  ].join('\n');
  console.log(body);
  setOut('health', body);
  process.exit(0);
}

console.log(`All ${repos.size} cited GitHub repositories look healthy.`);
