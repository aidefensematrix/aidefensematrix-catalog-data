# AI Defense Matrix Catalog: Data

This repository holds the product data behind the [AI Defense Matrix Catalog](https://catalog.aidefensematrix.com), a community-maintained catalog of products that secure AI. Each entry describes one product and its coverage on the [AI Defense Matrix](https://aidefensematrix.com). Every claim carries a trusted, dated source, so the catalog can present details you check for yourself.

Anyone can propose a product, a correction, or an update by opening a pull request. Changes are subject to maintainer review.

## What an entry looks like

Each product lives in its own directory with a single file:

```
products/<slug>/product.yaml
```

The file records the product's name, vendor, official URL, a sourced description, deployment, status, and matrix coverage. Each value carries a `source` with a URL and an `accessed` date. The [`matrix-ids.json`](./matrix-ids.json) file holds the asset classes and CSF functions you can use.

## How to contribute

You need Node 22+ and pnpm. Install the one dependency once with `pnpm install`.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the sourcing rules and the full schema. The short path:

1. Run `pnpm new-product "Product Name"` to scaffold an entry, or copy an existing directory.
2. Fill in `product.yaml`, and cite every claim to a page that supports it.
3. Run `pnpm validate` until it passes.
4. Commit with a sign-off (`git commit -s`) and open a pull request.

The validator checks structure, sourcing, dates, links, and ids, so you catch most issues before a maintainer does. [GOVERNANCE.md](./GOVERNANCE.md) explains who maintains the catalog and how the maintainer handles corrections. [SECURITY.md](./SECURITY.md) explains how to report a vulnerability.
The repository's [issues](../../issues) track known gaps and planned work.

## What this data feeds

The [catalog site](https://catalog.aidefensematrix.com) presents these entries as a filterable catalog, a coverage matrix, and per-product pages. That site reads this repository as its source of truth, so this is where you change a product's details. The site also publishes the entries as downloadable JSON and CSV. Each entry carries a `schema_version`, and a breaking change to the format bumps it, so machine consumers can detect format changes.

## License and credit

Catalog content is licensed under [CC BY-NC 4.0](./LICENSE), and [NOTICE](./NOTICE) credits the AI Defense Matrix, the framework the catalog entries build on. Including a product is not an endorsement, and product names and marks belong to their owners. [DISCLAIMER.md](./DISCLAIMER.md) explains how to treat the data.
