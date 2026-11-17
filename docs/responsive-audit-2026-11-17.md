# Responsive and Taxcom correction — 17 November 2026

This branch starts from the deployed source baseline `6a6407ea5feb32f25ded970f240832c62e7fd9f9`. It preserves service prices, tax rules and calculation formulas. Production backend services are unchanged.

## Changes

- Replace the text-based Taxcom imitation with the original outlined SVG from https://taxcom.ru/. The viewBox, all paths and official inherited colour are preserved; provenance/hashes are recorded in `assets/edo/taxcom-source.json`. The versioned image URL prevents an older browser cache from retaining the imitation.
- Keep the partner marks centred and proportional, with a single column on narrow screens so the wide official Taxcom mark remains readable. Other partner graphics are unchanged.
- Expose the existing main navigation links on mobile and keep them clear of the fixed header; prevent tariff tabs from overflowing the narrowest layout.
- Restore missing GRO image references in both languages using the existing deployed wordmark; preserve its proportions and light-theme contrast in header/footer.
- Keep the tax tool's navigation controls within narrow viewports and make closed drawers non-focusable.
- Preserve the currency date/status after loading and explicitly label demonstration values when the external source is unavailable.
- Move the already deployed number-parser/currency fallback/lead-endpoint response patches into source so these behaviours are reproducible from Git. These changes do not alter the deployed calculation logic.

## Validation before deployment

The candidate's eight content pages were measured at nine CSS widths: 320, 360, 375, 390, 414, 768, 1024, 1280 and 1440. Browser zoom was accounted for by verifying `innerWidth`, rather than assuming the requested physical viewport equals CSS pixels. No page overflow, missing image, offscreen control or header collision remained in the candidate matrix. The production www alias was checked separately as a redirect to the main page.

RU/ZH seven-step tariff examples return 8 000–11 000 RUB per quarter. Both tax examples return 2 800 000 RUB; changing annual revenue to 50 million changes the result to 11 200 000 RUB. The tax comparison drawer shows seven rows. Currency conversion and a local, no-quota source-outage fixture were tested; demonstration data are explicitly labelled. Candidate preview rejects every provider POST, so no lead or Checko quota is consumed there.

Run `node tests/static-regressions.mjs` for offline syntax, original vector-path hashes, image references, grouped-number inputs, preserved status/date and bounded currency-failure tests. The suite also compares scripts with the deployed baseline and its known response patches: only explicitly scoped status DOM-text changes are excluded; calculation statements must remain identical.

These are emulated browser layouts, not claims of testing physical phones or Safari/Firefox. Final public verification, authorized provider-call counts, rollback reference and before/after screenshots are retained in the owner's infrastructure audit documentation. Owner acceptance remains a separate step.
