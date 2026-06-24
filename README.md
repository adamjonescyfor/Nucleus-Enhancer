<div align="center">

# 🧭 CYFOR Nucleus Enhancer

### Supercharging Salesforce / Nucleus for CYFOR's various teams.

Faster casework, consistent reporting, and centrally‑managed templates — right inside Nucleus.

![Version](https://img.shields.io/badge/version-3.0.0-0e9aa7?style=for-the-badge)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-0b2a3a?style=for-the-badge)
![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Salesforce](https://img.shields.io/badge/Salesforce-OAuth%202.0-00A1E0?style=for-the-badge&logo=salesforce&logoColor=white)
![Internal](https://img.shields.io/badge/CYFOR-Internal%20Tool-0b2a3a?style=for-the-badge)

</div>

<!-- 📸 Optional banner: drop an image at docs/screenshots/banner.png and uncomment:
<p align="center"><img src="docs/screenshots/banner.png" alt="CYFOR Nucleus Enhancer" width="820"></p>
-->

---

> **What is it?** A Chrome extension that layers time‑saving tools on top of Salesforce/Nucleus — one‑keystroke template insertion from a centrally‑managed library, record navigation, notes formatting, column presets, photograph downloads, and a one‑click sanitised case‑report export. Install it, click **Connect Salesforce**, and go.

---

## 🚀 Getting started

1. **Install** the extension.
2. Open the popup and click **Connect Salesforce** — a normal Salesforce login window appears. That's the only setup you'll ever do. Select Remember Password to avoid having to repeatedly log in.
3. In any **Notes** or **Forensic Strategy** box, click the **📄 button** or **right‑click** to insert a template. 🎉

> 💡 Your team's official templates appear automatically and stay up to date in the background along with any global templates. The popup's **Help & tips** section lists every feature — including the easy‑to‑miss ones below.

<!-- 📸 Screenshot: docs/screenshots/popup.png — the extension popup -->

## ✨ What it does

| | Feature | How to use it |
|---|---|---|
| ⚡ | **Instant templates** | Click the 📄 button or right‑click in a Notes / Forensic Strategy box; **Alt+T** opens the menu, **Alt+Z** undoes an insert. Search and categories built in. |
| ☁️ | **Official templates** | Your team's approved templates (badged **Official**) sync down automatically — they can't be overridden by personal uploads. You can still load your own `.txt` templates alongside. |
| ⭐ | **Pins, recents & variables** | Pin favourites (☆ in the popup → ★ first in every menu); recently‑used float to the top; templates auto‑fill `{{date}}`, `{{time}}`, `{{dateTime}}`, `{{examiner}}`, `{{teamName}}`, `{{caseRef}}`. |
| 🕓 | **Right‑click quick‑fill** | Right‑click any date or time field for *now*; **Completed By / Sealed By / Conducted By / Assigned Staff** for *you*; **Exhibit Type** to auto‑pick from the exhibit name (SIM / memory / USB / drive); and a **Forensic Case** lookup to grab the latest case. |
| 🧭 | **Record navigation** | **Alt+← / Alt+→** (or the on‑page arrows) move between Exhibit Process records in list order. |
| 🏷️ | **Case project / alias** | A forensic case's **project (alias)** is shown next to it where Salesforce doesn't — Task pages, **Recently Viewed**, and any list without a Project column. |
| 📝 | **Notes formatting** | Notes columns in list views are expanded into readable, structured blocks automatically. |
| ↔️ | **Column presets** | Drag column names in the popup to reorder list‑view tables; save layouts as presets per table. |
| 📷 | **Photograph download** | A **Download All Photographs** button appears on Uploaded Documents sections and grabs everything in one go. Ensure that your browser settings do not ask you choose the location for each download before running this or you may be stuck doing this for each and every picture until it has completed. |
| 📄 | **Case Disclosure Report** | One‑click, commercially‑sanitised HTML report from any Forensic Case page, with a **Save as PDF** print view. |
| 🗂️ | **Template Manager** | Admins manage the whole template estate; everyone else gets a **read‑only viewer** — content, versions, review dates and history. |
| 🎨 | **Auto / Light / Dark** | One theme choice covers the popup, the manager **and** the in‑page UI, live with no refresh. |

### ⌨️ Keyboard shortcuts

| Shortcut | Action |
|:--:|---|
| **Alt + T** | Open the template menu in the active editor |
| **Alt + Z** | Undo the last template insertion |
| **Alt + ← / →** | Navigate between records |

Rebind via the popup's **Customise…** link.

---

## 🗂️ Template Manager

Everything lives in **Salesforce** — the manager is just a faster window onto the same records. Uninstalling the extension never touches the data.

**Template admins** get the full dashboard:
- **Create / edit / clone / delete** any team's templates and **assign** them to a team, **several teams**, or **Global**. *Clone* copies an existing template into a new **Draft**.
- **Rich‑text editing** — a full formatting toolbar (fonts, sizes, colour, bold/italic/underline, lists, indent, alignment, links, images), paste straight from Word, a live readout of the formatting at the cursor, and a character counter against Salesforce's field limit. Templates carry their formatting through into the Notes box on insert.
- **Version control** — minor/major bumps **only when content changes** (status/team/date edits don't create a version), a status lifecycle (Draft → Active → Under Review → Superseded → Retired), effective & review‑due dates, and a change reason for the audit trail.
- **History & diff** — browse snapshots, compare any two versions side‑by‑side, filter, export to CSV.
- **Reviews** — everything overdue or due within 30/60 days, surfaced on the dashboard and sidebar.
- **Usage** — an **org‑wide** insertion log (which templates are used, by whom, and where), backed by a per‑device local log.
- **Read‑acknowledgement (QMS)** — flag templates as **controlled documents**; analysts sign off "read & understood" per version, an **Acknowledgements** matrix shows who's outstanding per team, and a new version re‑opens the requirement. Built for UKAS / ISO 17025 evidence.
- **Suggestions** — analysts can propose edits; you review each in a **Suggestions** tab with a side‑by‑side **diff**, then **Apply** (opens it in the editor prefilled, so you finalise formatting and Save a normal versioned update) or **Reject**.

**Everyone else** — the popup's **View Templates** button opens the same page **read‑only**: your team's active templates plus Global, with full content, versions, review dates and history. Controlled documents show an **Acknowledge** button so you can record that you've read & understood the current version, and a **Suggest edit** button lets you propose changes for an admin to review. Transparency without edit risk.

> Only **Active** templates reach analysts — drafts, superseded and retired versions stay out of the insert menus. Deleting is for mistakes; for templates that were genuinely in use, **Retire** them instead so the audit trail survives.

<!-- 📸 Screenshot: docs/screenshots/manager.png — the Template Manager dashboard -->

---

## 🛡️ Salesforce setup (admins)

Everything the org needs — objects, permissions, and the rollout checklist — is in one guide:

➡️ **[docs/salesforce-admin-guide.md](docs/salesforce-admin-guide.md)**

The short version: the extension acts **as the signed‑in user**, so Salesforce permissions are the real access control. Analysts need Read on the Nucleus objects + a team‑membership record; template admins need the admin permission set (incl. **Delete/Modify All on the version object** — the #1 gotcha when deleting templates) plus the `IsAdmin__c` flag on their team membership. Analysts can belong to **several teams** (just give them one membership record each) and see every template targeted at any of them. Version snapshots are created by a [record‑triggered Flow](docs/salesforce-version-history-flow.md); **read‑acknowledgement** uses a small `NucleusTemplateAck__c` object + a `RequiresAck__c` checkbox ([setup](docs/salesforce-ack-object.md)); the org‑wide usage log uses `NucleusTemplateUsage__c` ([spec](docs/salesforce-usage-object.md)). Field API names are auto‑discovered from each object's describe — they never need to match exactly.

---

## 🔒 Security

Security was a first‑class concern throughout — built in **defence‑in‑depth**, not bolted on. The guiding principle: **the extension can only ever do what the signed‑in Salesforce user can do**, it holds no special or backdoor access, and your credentials never live inside it. The full, reviewer‑grade write‑up is in **[docs/SECURITY.md](docs/SECURITY.md)**; the essentials:

#### Your Salesforce credentials never touch the extension
- Sign‑in uses **OAuth 2.0 Authorization Code with PKCE** — the modern best‑practice flow. The secret half (the *code verifier*) is generated fresh each login and **never leaves your browser**, so an intercepted authorisation code is useless to anyone.
- A random, single‑use **CSRF `state`** is generated per login and verified on the callback, so a response can't be swapped in from anywhere else.
- The Salesforce **Consumer Key & Secret live only as encrypted secrets on a Cloudflare Worker** — never shipped in the extension, never committed to source control, never sent to your browser.
- Access & refresh **tokens are held only by the extension's background worker** on your own device — never by in‑page scripts, and never on any server.

#### The login proxy is locked down
- It is **stateless** — it stores **nothing** (no tokens, no user data, no database or edge cache), so there is no shared state that could leak or mix between users.
- **CORS fails closed** and it **rejects any browser origin that isn't this extension** before doing any work. It also verifies the redirect target server‑side and rate‑limits abuse.
- The real guarantee: the Consumer Secret never leaves Cloudflare, and the token endpoints require a **valid Salesforce authorisation code an attacker cannot forge** — so even a direct caller gets nothing.

#### The extension can only do what you can do
- It acts **as the signed‑in user** — Salesforce's own permissions and field‑level security *are* the access control. No elevated rights, no shortcuts around sharing rules.
- Every write path (create / edit / delete templates) is **admin‑gated**; everyone else gets a strictly **read‑only** view.

#### Your data stays between you and Salesforce
- Template and case data flows **directly** between the extension and Salesforce. The Worker only ever brokers the brief token exchange/refresh and **sees none of your data**.
- The disclosure‑report export **strips commercially sensitive content** before generating the document.

#### Hardened against tampering
- All HTML from Salesforce or templates passes through a **strict, whitelist‑based sanitiser** (the output is rebuilt from scratch, so script/`onerror`/`javascript:`/embedded‑SVG tricks can't survive); every rendered value is HTML‑escaped.
- The background worker **only accepts messages from this extension** — no website can drive it — and content scripts run in an **isolated world**, walled off from the page.

#### Privacy & transparency
- **No analytics, no telemetry** — nothing about your activity leaves your machine. Feature settings stay **on this device**; only low‑sensitivity preferences (theme, pinned templates) ride Chrome's own account sync if *you* have it enabled — never tokens or case data.
- The optional diagnostics log is **off by default**, auto‑disables after a day, and is only ever shared if **you** download and send it.

---

<details>
<summary><b>🧑‍💻 Developer notes</b> (one person needs this — everyone else can stop reading)</summary>

**Setup:** `cp config.example.js config.js` and set `oauthProxyUrl` to the Cloudflare Worker URL (gitignored). Deploy the worker from `oauth-proxy/` (`wrangler deploy`, then `wrangler secret put SF_CLIENT_ID / SF_CLIENT_SECRET / SF_INSTANCE_URL`); hardening lives in `wrangler.toml` — if the version gate is enabled, reload the extension to a matching version *before* deploying. Load unpacked via `chrome://extensions` (the manifest `key` pins the extension ID).

**Layout:** `content/` in‑page scripts · `background.js` + `background/` service worker & Salesforce modules · `popup/` · `manager/` · `report/` disclosure report · `styles/` tokens/theme/shared UI · `oauth-proxy/` the worker (never ship it in a package) · `docs/` admin guides, **[SECURITY.md](docs/SECURITY.md)** & **[ROADMAP.md](docs/ROADMAP.md)** (the implementable backlog).

**Golden rules:** code changes need a full extension reload (`chrome://extensions` → ↻), not a page refresh · Salesforce field API names are describe‑discovered, never hardcoded · `report/disclosure-report.js` + `styles/case-report.css` are the CTO's (don't edit) · the MG22 feature is Mitul's, flagged off via `MG22_ENABLED`.

</details>

---

## 🧪 Troubleshooting

| Symptom | Fix |
|---|---|
| Templates look out of date | **Sync Now** in the popup, or wait for the background sync (~20 min, while a Salesforce tab is open). |
| The 📄 button / right‑click menu isn't appearing | Make sure you're in a **Notes** or **Forensic Strategy** rich‑text box; check the toggles in the popup's Core Features. |
| "Export Case Report" button missing | Open a **Forensic Case** record page — it docks into the action bar. |
| Can't delete a template ("version history…") | Your admin permission set needs Delete on the version object — see the [admin guide](docs/salesforce-admin-guide.md). |
| A template won't save ("too long" / "data value too large") | Salesforce's Content field holds ~32,000 characters (formatting counts too) — the editor shows a live counter; trim the content or use a smaller image. |
| The team picker shows a single dropdown, not tick‑boxes | The `Teams__c` field's field‑level security isn't readable for your user — ask an admin to grant read on it (see the [admin guide](docs/salesforce-admin-guide.md)). |
| Something's misbehaving and you want it fixed | Popup → **Diagnostics** → turn on **Capture diagnostic log**, reproduce it, then **Download log** and send the `.txt` to the developer. See [docs/Nucleus_Enhancer_Diagnostics.md](docs/Nucleus_Enhancer_Diagnostics.md). |
| Anything else | The popup's **Help & tips** section, or ask your template admin. |

---

## 🗺️ What's next

The full, implementable backlog lives in **[docs/ROADMAP.md](docs/ROADMAP.md)**.

**Recently shipped:** bulk template operations · multi‑team **assignment** and **membership** · review‑due notifications · **read‑acknowledgement tracking** (controlled‑document "read & understood" sign‑off, with an admin who's‑outstanding matrix) · **suggest‑an‑edit** (analysts propose template changes; admins review with a diff and Apply/Reject).

**Still ahead:** the **MG22A/B Word report generator** (built, feature‑flagged off, owned by Mitul) · `manager.js` modularisation (internal code tidy‑up, no user‑facing change).

---

<div align="center">

**CYFOR Group — internal tooling.** Built for the digital forensics, cyber, cell site, and eDiscovery teams. 🔬

</div>
