# Governance

The catalog is a best-effort, sourced reference. Being explicit about how it is
maintained is what keeps it useful and fair.

## What the catalog contains

- **Sourced details, community-corrected.** Anyone can add or fix a product's details
  and matrix coverage by PR or issue, and every detail carries a trusted, dated source.
  Structure is validated automatically, and changes are subject to maintainer review.
- **Sourced details, without verdicts.** The catalog records each product's details
  and matrix coverage as the cited sources support them. It does not score, rank,
  rate, or recommend, so there is no maintainer-authored verdict to own or dispute.

## Product lifecycle and acquisitions

AI-security products get acquired, merged, renamed, and discontinued, often quickly. These
conventions keep the record current without churn:

- **Acquired (announced).** Set `status: acquired` with an `acquisition` block (acquirer,
  `announced` date, post-acquisition status) once a definitive agreement is public, even
  before close. The `announced` date marks the first public announcement rather than the
  close date. While the deal has not closed, set `pending_close: true` in the block; the
  product page then reports the acquisition as announced and pending rather than completed.
  Remove the flag with a changelog entry once the close is confirmed, and re-verify it
  whenever the entry is reviewed. Link the acquirer with `acquirer_slug` when it is also
  catalogued.
- **Merged into a new brand.** When a product is folded into a newly named platform, keep
  the entry under its known slug, set `status: merged`, and record the new name. Re-slug
  only once the new brand is unambiguously the ongoing product line.
- **Renamed while active.** When the same business renames or rebrands but stays an active,
  independent product (for example after it acquires another company), keep `status: active`,
  slug to the current name, list prior names in `aliases`, and record the dated rename in a
  `renamed_from` block (`name`, `date`, `source`); it renders as a "Formerly" line. This is
  distinct from *merged* or *acquired*, which apply only when the product is absorbed into an
  acquirer's product line and require an `acquisition` block.
- **Both parties catalogued.** When the acquired product and the acquirer's own AI offering
  each have an entry, keep both, link them, and avoid duplicating coverage of the same
  capability.
- **Discontinued or sunset.** Set the matching status and keep the entry for the record.

A status change on a reviewed entry is a proposal. Machines never auto-flip status, and
a status change needs a dated source that a maintainer can verify.

## Open-source project health

Open-source tools are eligible on the same evidence bar as commercial products, with a
project-health convention on top:

- **Adding.** An open-source project qualifies when its repository is not archived, shows
  commits within roughly the last six months, and the pull request records meaningful
  adoption evidence, such as forks, releases, published packages, or named adopters.
  Star counts are a soft adoption signal rather than a bar.
- **Lifecycle.** An archived repository or a published deprecation notice moves the entry
  to `status: discontinued`, cited to the repository page with the date observed. Roughly
  eighteen months without commits prompts a proposed status change for maintainer review.
  No status changes automatically, and star counts never trigger removal.

## Roles

- **Maintainer**: Reviews and merges changes and arbitrates disputes.
- **Trusted contributor** (earned): May get fast-merge for **details-only, official-tier,
  schema-passing** PRs.
- **Contributor**: Anyone opening an issue or PR.

## Correction handling

- The maintainer does their best to triage reports.
- A correction needs a valid source that a maintainer can verify.
- A vendor may submit a `vendor_response`, which the maintainer may publish verbatim
  on the product page.
- All reports and PRs follow the same **affiliation-disclosure** rules. Edits by
  undisclosed vendor employees to their own or rival entries may be declined.
- **One product per PR**, so edits stay independent. The maintainer may batch related
  maintenance edits across products in a single PR. Git and the maintainer resolve
  concurrent edits to the same entry, and a human edit wins over an automated proposal.
- **Errata**: when a shipped value proves wrong (a mis-mapped cell, a quote that does
  not support its claim, a stale fact), the fix lands as a normal PR whose changelog
  entry reads `Corrected <field> (erratum): ...` and references the triggering issue
  or audit when one exists. The entry keeps its history; the erratum line is the
  public record of the correction.
- **Periodic accuracy review**: the maintainer periodically re-verifies a sample of
  entries against their cited sources. Findings are corrections like any other and
  land as errata PRs.

### Reports outside GitHub

A report that arrives by email or through the operators' contact channels gets the
same review as an issue. The public record cites the supporting source rather than
the reporter, and the maintainer may credit a reporter by name, with the reporter's
consent. Reporters disclose affiliation the same way,
and when a vendor asks for a material change to its own entry, the changelog entry
says so.

### Vendor responses

A vendor may submit a `vendor_response` through a pull request from a disclosed vendor
affiliate, a vendor-response issue, or the operators' contact channels. Publishing a
response is at the maintainer's discretion, and the maintainer may take steps to
confirm that it comes from the vendor. The `received` date records when the response
arrived. The product page shows a published response verbatim, and the validator
applies the same limits to it as to any other text.

### Removing an entry

Removal is at the maintainer's discretion. An entry for a discontinued or absorbed
product normally stays in the catalog with the matching status, so the record remains
useful. To request removal, open a removal-or-dispute issue, or use the operators'
contact channels for confidential matters. Git history preserves removed entries.
