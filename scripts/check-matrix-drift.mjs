#!/usr/bin/env node
// Weekly drift guard: confirm the companion's PUBLISHED matrix artifact still uses
// the same asset/function ids we hold in matrix-ids.json. Read-only,
// tolerant of an unreachable companion (the companion may not be deployed yet).
// Writes `drift` to $GITHUB_OUTPUT only when ids actually diverge.

import { appendFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// matrix-ids.json (this repo's canonical taxonomy) is the source of truth.
const IDS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'matrix-ids.json'), 'utf8'),
);
const EXPECTED_ASSETS = IDS.asset_ids;
const EXPECTED_FUNCTIONS = IDS.function_ids;
const URL = process.env.COMPANION_MATRIX_URL || 'https://aidefensematrix.com/ai-defense-matrix.yaml';

const setOut = (k, v) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__EOF__\n${v}\n__EOF__\n`);
};

let text;
try {
  const res = await fetch(URL, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!res.ok) { console.log(`Companion artifact not reachable (HTTP ${res.status}); skipping.`); process.exit(0); }
  text = await res.text();
} catch (e) {
  console.log(`Companion artifact not reachable (${e.message}); skipping.`);
  process.exit(0);
}

// Coarse but reliable: every expected id must appear as a token in the artifact.
// Missing tokens = a rename/removal upstream = real drift worth a human look.
const missingAssets = EXPECTED_ASSETS.filter((id) => !new RegExp(`\\b${id}\\b`).test(text));
const missingFns = EXPECTED_FUNCTIONS.filter((id) => !new RegExp(`\\b${id}\\b`).test(text));

// Best-effort: if the artifact parses as a row array, surface unexpected new ids.
let extraAssets = [];
try {
  const doc = parse(text);
  if (Array.isArray(doc)) {
    const ids = doc.map((r) => r && r.id).filter((x) => typeof x === 'string');
    extraAssets = ids.filter((id) => !EXPECTED_ASSETS.includes(id));
  }
} catch {
  /* token check above is enough */
}

if (missingAssets.length || missingFns.length || extraAssets.length) {
  const body = [
    'The companion AI Defense Matrix ids no longer match `matrix-ids.json`.',
    missingAssets.length ? `- Missing asset ids: ${missingAssets.join(', ')}` : '',
    missingFns.length ? `- Missing function ids: ${missingFns.join(', ')}` : '',
    extraAssets.length ? `- Unexpected new asset ids upstream: ${extraAssets.join(', ')}` : '',
    '',
    `Source: ${URL}`,
  ].filter(Boolean).join('\n');
  console.log(body);
  setOut('drift', body);
  process.exit(0);
}

console.log('Matrix ids are in sync with the companion artifact.');
