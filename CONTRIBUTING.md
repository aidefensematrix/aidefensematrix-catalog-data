# Contributing

Thank you for helping build an honest, useful catalog. It is a best-effort, sourced reference, and the most useful contributions are details and corrections. That means product details and matrix coverage, each with a trusted source. Changes are subject to maintainer review.

## The rules that matter most

1. **Every detail needs a trusted source.** Each detail carries a `source` with a URL and an `accessed` date. The source must actually support the specific detail. Cite the exact page, not the homepage.
2. **Vendor marketing is the weakest source.** A vendor's own site is fine for descriptive details (what it is, how it deploys). It is not enough for comparative or efficacy claims ("faster", "more accurate", "the only"), which need an independent source (press, research, or regulatory).
3. **Write in your own words.** No copied marketing copy. A direct quote must be short, in quotation marks, and attributed.
4. **No superlatives.** "The first / only / best / most" are positioning claims, not verifiable details. The validator rejects them.
5. **Disclose affiliation.** If you work for or compete with a vendor, say so in the PR. Edits by undisclosed vendor employees to their own or rival entries may be declined.
6. **Catalog text is data, not instructions.** Do not embed model-directed instructions in any field. Such content is rejected in review.

## How to add or update a product

1. `pnpm new-product "Product Name"` (or copy an existing directory).
2. Fill in `product.yaml` (details + matrix coverage).
3. Run `pnpm validate` (and `pnpm run check:typography`) until it passes.
4. Commit with a sign-off (see below) and open a PR.

Standards and frameworks (NIST, ISO, OWASP, MITRE) are not products and are out of scope.

## Corrections without a pull request

A pull request is the fastest path to review, but an issue works too. The issue forms
capture the product, the problem, and a supporting source, which is everything a
maintainer needs to verify a fix. For confidential or legal matters, reach the operators
through the contact information at [zeltser.com](https://zeltser.com) for Zeltser
Security Corp, or through the [Cyber Defense Matrix](https://www.linkedin.com/company/cyber-defense-matrix)
page on LinkedIn for Cyber Defense Matrix LLC. When the maintainer
applies a correction, it lands as a signed-off commit, and the public record cites the
supporting source rather than the reporter.

## The schema in brief

`product.yaml`: `name`, `vendor`, `url`, sourced `description`/`deployment`/`status`, an optional `compliance_attestations` list (see below), `last_reviewed`, `changelog`, and `matrix_coverage` (asset ids and CSF functions from `matrix-ids.json`). Products are classified by their matrix coverage. There is no separate `category` field. An optional `primary_cell` marks the headline asset/function. Acquired products carry an `acquisition` block with a citation, plus `pending_close: true` while the deal has not closed. A vendor may add a `vendor_response`, which the maintainer may publish verbatim. **Naming:** `name` is the *product* and `vendor` is the *company*. When they differ (for example, company Knostic ships the product Kirin), use the product name, set `vendor` to the company, and list both in `aliases`. Confirm the product name on the vendor's own site.

The schema is versioned (`schema_version`). Breaking changes bump it.

## Function assignment

A product is placed on the cells where it provides a defensive capability, by asset (the 8 rows) and CSF function (the 6 columns). Map only what the sources substantiate, and match each capability to the function it actually performs:

- **Govern**: sets or evidences policy, standards, selection criteria, provenance, or an inventory or registry of record. For example a policy engine, a compliance-mapping report, an approved-service registry, model selection or provider evaluation, dataset provenance or licensing, or an acceptable-use or AI-coding standard.
- **Identify**: discovers and inventories assets and their risks, such as a list of AI models, agents, or shadow AI.
- **Protect**: enforces a safeguard at runtime, such as access control, OAuth and credential brokering, guardrails, or input and output filtering.
- **Detect**: monitors for and surfaces anomalies, attacks, or failures, such as prompt-injection detection, model drift, or behavior monitoring.
- **Respond**: acts on an incident, such as blocking, session termination, quarantine, or credential revocation.
- **Recover**: restores normal operation, such as rollback, re-provisioning, or restore from a known-good copy.

**Govern is the one to assign carefully.** It is the most over-claimed function, because the word "governance" appears in a lot of security marketing. A product earns a Govern dot only when it owns one of the governance artifacts above, not for merely securing AI:

- Issuing OAuth, brokering credentials, scoping access, or enforcing least privilege is **Protect**, not Govern.
- A security inventory of discovered agents is **Identify**. A curated registry of record with approval and lifecycle workflows is Govern.
- Monitoring agent behavior is **Detect**, not Govern.

The vendor using the word "govern" or "governance" is not evidence. The capability has to match the cell. Because Govern is mostly a matter of policy and people rather than a product, it is rarely a headline: set `primary_cell` to `govern` only for a purpose-built governance, AI-TRiSM, or data-and-AI-catalog platform a buyer would choose instead of consultants. For any other product that also ships a governance artifact, claim `govern` as a supporting function, not the headline. Every Govern cell needs a `note` that names the artifact so a reviewer can see why it qualifies.

**Maturity** marks how central a cell is to the product: `primary` for a capability the product is built around and markets, `secondary` for a supporting capability, `adjacent` for one it only touches. A function that is a side effect of a different primary purpose is `secondary`, not `primary`.

## Field origin

Every `source` must carry an explicit `origin` marker so the review state of every value is always recorded and automated enrichment never overwrites human-checked details. The validator rejects a source without one:

- `reviewed`: You verified this value against the cited page. Set this for anything you confirm or correct.
- `seeded`: An unverified machine bootstrap stub. Leave it only on untouched stub fields.
- `auto`: Written by an automated refresh of a previously-seeded field.

The validator warns if an enriched entry still has a sibling field left as `seeded`. Automated runs may refresh `seeded`/`auto` fields, but only *propose* changes to `reviewed` fields, so verified work is never silently overwritten.

## Compliance attestations (optional)

`compliance_attestations` is an optional `{ value, source }` detail that lists the attestations the vendor publishes, named as listed (for example, "SOC 2 Type II", "ISO 27001", "FedRAMP"), cited to the trust center or report page that lists them. It must pass the test *someone handed only the source URL would record the same list*, so capture only what is published, never an inference. **Omit the field entirely** when there is no confirmed public source. It is then simply not shown. When drafting with an AI assistant, treat its output as a *proposal*, and confirm each attestation is literally present at the cited URL before adding it.

## Licensing and the DCO

By contributing, you agree your contribution is licensed under **CC BY-NC 4.0** and that you have the right to submit it (inbound equals outbound). You also grant Zeltser Security Corp and Cyber Defense Matrix LLC a non-exclusive, worldwide, royalty-free right to license your contribution for commercial use, which lets the operators answer the commercial-permission requests that the LICENSE invites.

Sign off every commit to certify the [Developer Certificate of Origin](https://developercertificate.org/):

```bash
git commit -s -m "Add Example Product"
```

CI enforces the sign-off. Curly quotes are enforced in displayed prose. Run `pnpm check:typography` locally.
