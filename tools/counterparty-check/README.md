# Counterparty Check

Frontend and backend source for `https://checking.gro-consult.ru/`.

Production uses a server-side `.env` with `CHECKO_API_KEY`. Do not commit real keys.

Tracked:

- `public/` - static frontend.
- `server.py` - Python backend used by the production service.
- `server.js` - Node.js backend variant kept for development.
- `.env.example` - safe configuration template.

Not tracked from the old local folder:

- real `.env`;
- temporary relay files;
- old Checko diagnostics captures and packet dumps.
