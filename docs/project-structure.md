# GRO Consulting project structure

This repository keeps the public GRO Consulting site and the related MVP tools in one version-controlled place.

## Public site

- `/index.html` - Russian landing page, deployed to `https://gro-consult.ru/`.
- `/zh/index.html` - Chinese landing page, deployed to `https://gro-consult.ru/zh/`.
- `/tax/index.html` - tax regime calculator on the main domain.
- `/zh/tax/index.html` - Chinese tax regime calculator on the main domain.
- `/assets/` - partner logos and service assets used by the landing page.

## Standalone tools

- `/tools/currency-calculator/` - standalone currency calculator, deployed to `https://currency.gro-consult.ru/`.
- `/tools/counterparty-check/` - counterparty check frontend and backend sources, deployed to `https://checking.gro-consult.ru/`.
- `/tools/tax-calculator/` - standalone local copy of the tax calculator used during development. The public production route currently lives in `/tax/` and `/zh/tax/`.

## Services

- `/services/site-leads-api/` - Telegram lead relay API for site forms.

## Secrets

Real `.env` files are intentionally not tracked. Use `.env.example` files as templates and keep production secrets only on the server.

## Deployment notes

Current production server paths:

- Main site: `/var/www/gro-consult.ru`
- Currency calculator: `/var/www/currency.gro-consult.ru`
- Counterparty check: `/var/www/checking.gro-consult.ru`
- Leads API: `/var/www/site-leads-api`

Before production deploy, create a backup under `/var/www/backups/`.

Important: the Git repository root is not the same thing as the main public web root. Do not deploy `/tools/`, `/services/`, `/docs/`, or deployment helper files to `https://gro-consult.ru/`. They are version-controlled sources. Deploy them only to their intended service/domain.
