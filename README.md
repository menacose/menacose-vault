# MENACOSE Team Hub

A local website extracted from the INCOSE MENA Obsidian vault. No dependencies or account required; Node.js 20+.

## Run

    npm run import
    npm start

Open http://127.0.0.1:4173. Keep the terminal running while using the site.

The default vault is the sibling `../menacose-vault`. To use another:

    node scripts/import-vault.mjs "C:/path/to/vault"

After changes in Obsidian, run the import command again and reload the website.

## Data and editing

- Action Register is the canonical source of actions; Work Overview supplies project and recurring activity status. Weekly board meeting files supply the meeting archive. Duplicate review rows are not imported as new actions.
- Recorded status, ownership, dates and uncertainties are preserved. A meeting note may be an agenda rather than completed minutes.
- Drag cards or use the accessible status selector inside a card. Changes are stored in localStorage in this browser and override imported statuses by action ID. They do not update Obsidian or other team members. Use Reset to return to the latest snapshot.
- Export downloads the current board as JSON for review. This is not an automatic write-back or shared backend.
- Obsidian source links open the installed Obsidian app and `menacose-vault` vault.
- Dates use Europe/Berlin to determine today. Date-only deadlines are preserved. Blank dates remain unagreed.
- No source vault files are modified. Only curated register data and meeting summaries are copied into public/data.json. Review this data before hosting or sharing.
- Fonts use Google Fonts with local system fallbacks.

## Structure

`public/` is the static website. `scripts/import-vault.mjs` regenerates its data. `scripts/serve.mjs` serves on loopback only. Deploying the public folder would expose its snapshot to visitors; this implementation is local only.

## Checks

    npm run check
