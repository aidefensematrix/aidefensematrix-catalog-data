#!/usr/bin/env node
// Scaffold a new product entry (details) from the schema, with valid
// placeholders so you can iterate with `pnpm validate`. Replace every TODO and
// the example.com URLs with real, sourced values before opening a PR.
//
//   pnpm new-product "Product Name"

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Usage: pnpm new-product "<Product Name>"');
  process.exit(2);
}
const kebab = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const slug = kebab(name);
const dir = join(process.cwd(), 'products', slug);
if (existsSync(dir)) {
  console.error(`Already exists: products/${slug}`);
  process.exit(1);
}
const DATE = new Date().toISOString().slice(0, 10);

const product = `schema_version: 2
name: ${name}
vendor: TODO vendor name
url: https://example.com           # TODO official product URL (https)
description:
  value: TODO one original sentence (20-200 chars) describing what it does.
  source: { url: https://example.com, tier: official, accessed: ${DATE}, origin: reviewed }
deployment:
  value: [saas]                    # any of: saas, self-hosted, hybrid
  source: { url: https://example.com, tier: official, accessed: ${DATE}, origin: reviewed }
status:
  value: active                    # active | acquired | discontinued | merged
  source: { url: https://example.com, tier: official, accessed: ${DATE}, origin: reviewed }
# Optional: compliance attestations the vendor publishes. Uncomment if you can
# source them; omit the field entirely otherwise. Name each as listed and cite the
# trust center or report page that lists them.
# compliance_attestations:
#   value: [SOC 2 Type II, ISO 27001]
#   source: { url: https://example.com/trust, tier: official, accessed: ${DATE}, origin: reviewed }
last_reviewed: ${DATE}
changelog:
  - date: ${DATE}
    summary: Initial entry.
matrix_coverage:
  - asset: runtime-ai-data         # TODO ids from matrix-ids.json
    functions: [protect]
    maturity: primary              # primary | secondary | adjacent
    source: { url: https://example.com, tier: official, accessed: ${DATE}, origin: reviewed }
primary_cell:
  asset: runtime-ai-data
  function: protect
`;

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'product.yaml'), product, 'utf8');
console.log(`Scaffolded products/${slug}/product.yaml.`);
console.log('Replace every TODO and the example.com URLs, then run: pnpm validate');
