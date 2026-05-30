# CYFOR Nucleus Enhancer

A Chrome (Manifest V3) extension that enhances the Salesforce/Nucleus Lightning experience for CYFOR's forensics teams — template insertion, record navigation, notes formatting, column reordering, and a one-click disclosure-report export.

## Features

- **Template insertion** — insert standardised templates (incl. Forensic Strategy) into Notes / rich-text fields via a floating button, a right-click menu (search + category filter), or **Alt+T**. **Alt+Z** undoes the last insertion.
- **Smart suggestions** — when a process type is mapped to a template, an empty Notes field offers a one-click insert (or auto-inserts if you enable it).
- **Salesforce templates (OAuth)** — sync your team's official templates from Salesforce. Team managers can create/edit/delete them in the **Template Manager** (full-page options view).
- **Right-click Date/Time** — fill Lightning date/time pickers with the current date/time.
- **Record navigation** — move between Exhibit Process records with **Alt+←/→**.
- **Notes formatting** — expand concatenated notes in list views into readable blocks.
- **Column reordering** — drag-reorder Lightning datatable columns, with savable presets.
- **Disclosure report** — one-click, commercially-sanitised HTML report for a Forensic Case, with a **Save as PDF** print view.
- **Usage log** — a local, per-device audit trail of template insertions (viewable in the Template Manager).
- **Appearance** — Auto / Light / Dark theme picker.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Alt+T** | Open the template menu in the active editor |
| **Alt+Z** | Undo the last template insertion |
| **Alt+← / Alt+→** | Navigate between records |

Rebind these any time via the popup's **Customise…** link (opens `chrome://extensions/shortcuts`).

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. The extension ID is fixed by the manifest `key`, so it stays stable across reloads.

## Salesforce OAuth setup

OAuth runs through a **Cloudflare Worker proxy** ([oauth-proxy/](oauth-proxy/)) so the Salesforce **Consumer Key and Secret are never shipped in the extension or committed to git** — they live only as Cloudflare secrets.

1. Copy `config.example.js` → `config.js` and set `oauthProxyUrl` to your Worker URL. **`config.js` is gitignored — never commit it.**
2. Deploy the worker: `cd oauth-proxy && wrangler deploy`, then set the secrets:
   ```
   wrangler secret put SF_CLIENT_ID       # Consumer Key
   wrangler secret put SF_CLIENT_SECRET   # Consumer Secret
   wrangler secret put SF_INSTANCE_URL    # e.g. https://cyfor.my.salesforce.com
   ```
3. The worker is hardened with a CORS origin lock, a server-side redirect-URI check, per-IP rate limiting, input validation, and an optional client-version gate (see [oauth-proxy/wrangler.toml](oauth-proxy/wrangler.toml)).
4. In the popup, connect via **Salesforce Account**.

## Troubleshooting

- **A change to the code didn't take effect** — content scripts and the service worker only update on a **full extension reload** (`chrome://extensions` → ↻), *not* a page refresh. After editing the worker, redeploy with `wrangler deploy`.
- **"Export Case Report" button missing** — open a Forensic Case record; the button docks into the highlights action bar. If it lags, it re-injects on re-render.
- **Login fails after a worker change** — confirm the extension ID on `chrome://extensions` matches `ALLOWED_ORIGIN` / `ALLOWED_REDIRECT_PREFIX` in `wrangler.toml`.

## Security model

- Consumer Key/Secret never leave Cloudflare; the extension only knows the non-secret proxy URL.
- Tokens are stored in `chrome.storage.local` and refreshed via the proxy.
- SOQL values are escaped/validated; the report escapes all field data before rendering.
- See [oauth-proxy/worker.js](oauth-proxy/worker.js) for the proxy hardening layers.

## Project layout

| Path | Purpose |
|---|---|
| [content/](content/) | Content scripts injected into Lightning pages |
| [background.js](background.js), [background/](background/) | Service worker + Salesforce modules |
| [popup/](popup/) | Browser-action popup |
| [manager/](manager/) | Full-page Template Manager (options page) |
| [report/](report/) | Disclosure-report generator + live fetch |
| [styles/](styles/) | Shared CSS (design tokens, theme, injected UI) |
| [oauth-proxy/](oauth-proxy/) | Cloudflare Worker OAuth proxy |
