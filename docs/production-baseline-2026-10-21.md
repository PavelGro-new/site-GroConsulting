# Production baseline — 21 October 2026

This branch starts from `master` at `82f0d4ce10da29a0e36e8b513d20497415b9fb5e`. It records a read-only comparison with the working GRO Consulting site. No deployment is associated with this branch.

## Verified code

The owner holds a private, password-free archive of the exact published files. Its SHA-256 is `bd97a1834f26a572b62397b3282d7dd6e8f89ad1c862ece79403c152dccf77fa`. The archive was extracted successfully; SHA-256 of all 45 captured source/configuration files matched the running server at capture time. Secret files, databases, credentials and user data were excluded.

Thirty-nine deployed source and asset files map to files already present on `master` with identical Git-normalized content. These include the main site, embedded tax calculator and Chinese pages; the currency tool; the counterparty interface and Python backend; and the Python lead handler. Some raw files differ in line endings, which the private archive preserves exactly. The short README on the server differs from the repository README; the repository documentation is retained.

The standalone `tools/tax-calculator/` copies are not the deployed `/tax/` files. Their visible source difference is a local-development navigation URL. They are retained to avoid changing the separate tool. The Node.js alternatives, package files, development scripts and documentation in this repository are also retained; they are not deployed as the two running Python services.

## Branch relationship and future deployment

`main` (`c57d6ff`) is an ancestor of `master` and is three commits behind it. It has no commits unique to `main`. The running server checkout is at `b7165c2`, two commits behind `master`; the published site files were copied into its worktree without updating that checkout. Before any merge or deploy, review this branch against `main`, choose one development/deployment branch, test the static pages and Python endpoints, and document the deployment procedure. Never reset the running server to `main` merely because it is the GitHub default branch.

This branch intentionally adds only this provenance note. The site code on `master` already matches the live code after Git line-ending normalization. The exact raw production bytes remain in the private archive. The archive does not contain the live service credentials or the Meeting Assistant database and therefore cannot restore every function by itself.