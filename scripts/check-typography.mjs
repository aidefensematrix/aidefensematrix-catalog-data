#!/usr/bin/env node
// Content-aware curly-quote lint. The companion's lint is code-shaped (it strips
// JS/HTML syntax); reusing it on Markdown/YAML would mis-fire on prose
// contractions and YAML quoting. This version lints only DISPLAYED PROSE:
//   - product.yaml: description.value, matrix_coverage[].note, vendor_response.text
// URLs and enum/id values are never linted. Exits non-zero on any violation.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const PRODUCTS = join(process.cwd(), 'products');
const violations = [];

const STRAIGHT_APOS = /[A-Za-z]'[A-Za-z]/; // it's, don't
const STRAIGHT_DQUOTE = /"/; // any straight double quote in prose

function lint(slug, where, text) {
  if (typeof text !== 'string' || !text) return;
  if (STRAIGHT_APOS.test(text)) violations.push(`${slug} ${where}: straight apostrophe — use ’`);
  if (STRAIGHT_DQUOTE.test(text)) violations.push(`${slug} ${where}: straight double quote — use “ ”`);
}

const dirs = existsSync(PRODUCTS)
  ? readdirSync(PRODUCTS).filter((d) => statSync(join(PRODUCTS, d)).isDirectory())
  : [];

for (const slug of dirs) {
  const productPath = join(PRODUCTS, slug, 'product.yaml');
  if (existsSync(productPath)) {
    try {
      const p = parse(readFileSync(productPath, 'utf8'));
      lint(slug, 'description', p?.description?.value);
      lint(slug, 'vendor_response', p?.vendor_response?.text);
      if (Array.isArray(p?.compliance_attestations?.value))
        p.compliance_attestations.value.forEach((a, i) =>
          lint(slug, `compliance_attestations[${i}]`, a),
        );
      if (Array.isArray(p?.matrix_coverage))
        p.matrix_coverage.forEach((c, i) => lint(slug, `matrix_coverage[${i}].note`, c?.note));
    } catch {
      /* parse errors are validate.mjs's job */
    }
  }

}

if (violations.length) {
  console.error(`Typography: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`Typography: clean (${dirs.length} entries).`);
