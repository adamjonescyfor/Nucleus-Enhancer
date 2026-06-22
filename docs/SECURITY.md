# Security overview — CYFOR Nucleus Enhancer

A reviewer‑grade summary of the extension's security design, for admins, InfoSec, and accreditation (UKAS / ISO 17025) purposes. Everything here reflects what the code actually does.

## Principles

- **Least privilege / acts as the user.** The extension performs every Salesforce read and write **as the signed‑in user**, over that user's own OAuth token. It has no service account, no elevated rights, and no way around Salesforce sharing rules or field‑level security. If a user can't do something in Salesforce, the extension can't do it for them.
- **Defence in depth.** No single control is relied on alone — credentials, transport, authorisation, input handling and messaging each have their own protections.
- **Minimal footprint.** Template and case data move **directly** between the extension and Salesforce. The only third‑party component is a thin, stateless OAuth proxy that brokers the login handshake and never sees user data.

## 1. Authentication & credentials

- **OAuth 2.0 Authorization Code + PKCE.** Sign‑in uses the modern best‑practice flow. A cryptographically random **code verifier** (32 bytes from `crypto.getRandomValues`) is generated per login and **never leaves the browser**; only its SHA‑256 challenge is sent. An intercepted authorisation code is therefore useless without the verifier.
- **CSRF `state`.** A random, single‑use `state` is generated per login and **verified on the callback**; a mismatch aborts the sign‑in. This binds the response to the request the extension started.
- **Consumer Key & Secret are never in the client.** They exist only as **encrypted Cloudflare Worker secrets**. They are never shipped in the extension package, never committed to source control, and never returned to the browser. (`config.js`, which only holds the proxy URL, is git‑ignored.)
- **Token storage.** Access and refresh tokens live **only** in the extension's background service worker (`chrome.storage.local`). They are **never** exposed to content scripts (verified — no content script references the token keys) and **never** stored on any server.
- **Token refresh** is lazy/on‑demand and shares a single in‑flight request, which avoids both wasted refreshes and the refresh‑token‑rotation race that can cause spurious logouts. Because refresh only happens inside an active operation, the MV3 service‑worker lifecycle cannot orphan it, and refreshed tokens are persisted immediately.
- **Disconnect** removes all tokens and cached data locally and best‑effort revokes the token via the proxy.

## 2. The OAuth proxy (Cloudflare Worker)

A small Worker (`oauth-proxy/worker.js`) holds the Consumer Key/Secret and brokers `/auth-url`, `/token`, `/refresh`, `/revoke`. Its protections:

- **Stateless.** No KV, D1, R2 or cache — it stores **nothing**. Tokens transit it in the request/response but are never persisted, so there is no shared edge state to leak or to mix between users.
- **Secret never leaves Cloudflare.** `SF_CLIENT_SECRET` is used only inside the server‑side POST to Salesforce's token endpoint. It is never logged and never included in any response.
- **CORS fails closed.** The Worker only ever reflects the **exact allow‑listed extension origin** (`ALLOWED_ORIGIN`); it never emits a wildcard, and a missing/misconfigured value blocks browsers rather than opening up.
- **Unauthorised origins are rejected.** A request carrying a browser `Origin` that isn't this extension is **403'd before any work** (defence in depth on top of CORS).
- **Server‑side redirect check.** `redirect_uri` must match the extension's own `chromiumapp.org` callback (`ALLOWED_REDIRECT_PREFIX`) — enforced for every caller, including non‑browser clients.
- **Rate limiting** (per‑IP) and an optional **minimum‑client‑version** gate.
- **The real guarantee:** even a caller who bypasses CORS gets nothing, because `/token` and `/refresh` require a valid Salesforce authorisation code / refresh token that an attacker cannot forge, and the secret needed to redeem them never leaves the Worker.

## 3. Authorisation & access control

- **Salesforce is the access control.** All gating is enforced server‑side by Salesforce object permissions, FLS and sharing — the extension simply surfaces what the user is allowed to see/do.
- **Admin‑gated writes.** Creating, editing, deleting and re‑assigning templates require the user to be a template admin (the `IsAdmin__c` flag **and** the admin permission set). Everyone else gets a strictly **read‑only** viewer; the background even re‑checks admin status server‑side, returning `PERMISSION_DENIED` to non‑admins.
- **Acknowledgements & suggestions** (QMS features) follow the same model: members can only create their own records; only admins can read all and resolve them.

## 4. Data handling & storage

- **Direct to Salesforce.** Template/case data never passes through the proxy or any third party — only the OAuth handshake does.
- **Local storage is bounded.** Every cache has a hard cap (e.g. the navigation cache is LRU‑30; the diagnostics buffer is capped) so nothing grows without bound. No temp files are created; downloads go straight to the user's Downloads folder.
- **The disclosure report** strips commercially sensitive content before producing its sanitised output.
- **SOQL safety.** Even though queries run under the user's own token (not a privilege boundary), interpolated values are escaped and record IDs / API names are validated, so a stray value can never alter a query's structure.

## 5. Application security

- **HTML sanitiser** (`lib/sanitize-html.js`). All template/Salesforce HTML is run through a strict, **whitelist‑based** sanitiser whose output is **rebuilt node‑by‑node from scratch** (resistant to mutation‑XSS). Only safe tags survive; only an allow‑list of attributes is copied (so `onclick`/`onerror` and other event handlers can never carry through); `javascript:`, `url(...)`, `expression()` and `@import` are blocked in styles; `<script>`, `<iframe>`, `<object>` and **embedded SVG / `data:text/html`** are dropped. Every other dynamic value rendered in the UI is HTML‑escaped with a context‑safe escaper.
- **Message security.** The background worker validates that every message comes from this extension (`sender.id`); there is **no** `externally_connectable` and **no** external‑message listener, so no web page can drive it. Web‑accessible resources are limited to a single logo image.
- **Isolation.** Content scripts run in the **isolated world**, separate from the page's own JavaScript.
- **No remote code.** The extension ships and runs only its own bundled code — nothing is fetched and executed at runtime.

## 6. Privacy

- **No analytics or telemetry.** The extension sends nothing about a user's activity to anyone. Its only network calls are to **Salesforce** (the user's own org) and the **OAuth proxy** (login only).
- **Settings are per‑device.** Feature toggles are stored locally. The only things that sync are low‑sensitivity preferences (theme, pinned‑template list), and only via Chrome's own account sync if the user has it enabled — never tokens or case data.
- **Diagnostics are opt‑in.** Debug logging is **off by default**, auto‑disables after 24 hours, is capped in size, and is only ever shared if the user explicitly downloads the file and sends it.

## 7. Out of scope / non‑goals

- The extension does not protect against a compromised Salesforce account or a malicious template **admin** — those are governed by Salesforce permissions and your own joiner/leaver process.
- It cannot send email; notification emails (e.g. acknowledgement reminders) are a Salesforce‑side Flow, not the extension.
- The Cloudflare Worker's own account security (Cloudflare login, secret rotation) is an operational responsibility, documented in `oauth-proxy/`.
