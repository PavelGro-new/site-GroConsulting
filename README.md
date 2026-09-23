# GRO Consulting site

Production site and MVP tools for GRO Consulting.

## Structure

- `/index.html` - Russian landing page.
- `/zh/index.html` - Chinese landing page.
- `/tax/` and `/zh/tax/` - tax regime calculator on the main domain.
- `/assets/` - site assets, partner logos and EDO logos.
- `/tools/currency-calculator/` - standalone currency calculator for `currency.gro-consult.ru`.
- `/tools/counterparty-check/` - counterparty check frontend and backend sources for `checking.gro-consult.ru`.
- `/tools/tax-calculator/` - standalone development copy of the tax calculator.
- `/services/site-leads-api/` - Telegram lead relay API for site forms.
- `/docs/project-structure.md` - deployment and ownership notes.

## Secrets

Real `.env` files are not tracked. Use `.env.example` files as templates and keep production secrets only on the server.


## Deployment rule

Do not copy the whole repository to the main web root. The repository contains backend and tool sources under `/tools/` and `/services/`.

For `https://gro-consult.ru/`, deploy only:

- `index.html`
- `zh/`
- `tax/`
- `assets/`
- favicon and app icon files

Deploy standalone tools to their own hosts from `/tools/...`.
