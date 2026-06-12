<!--
Thanks for contributing. CI validates structure automatically; this checklist covers
what CI cannot. PRs that fail CI are not reviewed until green.
-->

## What this PR does

<!-- new product / detail update / correction / lifecycle change or removal proposal -->

## Checklist

- [ ] One directory under `products/<slug>/`; `<slug>` is the kebab-case of `name`.
- [ ] `pnpm validate` passes locally.
- [ ] Every detail carries a trusted `source` with an `accessed` date, and the source actually supports the claim.
- [ ] Comparative or efficacy claims cite an independent source (`press` / `research` / `regulatory`), not vendor marketing.
- [ ] Prose is original (no copied marketing copy); any direct quote is short, quoted, and attributed.
- [ ] This is a real, shipping product, not a standard or framework.
- [ ] `last_reviewed` is set to today.
- [ ] Affiliation disclosed (I do / do not work for or compete with this vendor): __________
- [ ] Commits are signed off (`git commit -s`) for the DCO.
