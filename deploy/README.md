# Deployment notes

This repository is a small monorepo. It contains the public landing page, standalone tools and backend services.

## Main site

Deploy to `/var/www/gro-consult.ru` only these public files and folders:

- `index.html`
- `zh/`
- `tax/`
- `assets/`
- `favicon.ico`
- `favicon-32x32.png`
- `apple-touch-icon.png`
- `icon-192.png`

Do not deploy:

- `tools/`
- `services/`
- `docs/`
- `deploy/`
- `.gitignore`
- `README.md`

## Standalone tools

- `tools/currency-calculator/` -> `/var/www/currency.gro-consult.ru`
- `tools/counterparty-check/public/` -> `/var/www/checking.gro-consult.ru/public`
- `tools/counterparty-check/server.py` -> `/var/www/checking.gro-consult.ru/server.py`

## Services

- `services/site-leads-api/` -> `/var/www/site-leads-api`

Keep real `.env` files only on the server.
