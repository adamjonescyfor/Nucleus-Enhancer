<div align="center">

# 🧭 CYFOR Nucleus Enhancer

### Supercharging Salesforce / Nucleus Lightning for CYFOR's digital‑forensics teams.

Faster casework, consistent reporting, and centrally‑managed templates — right inside Nucleus.

![Version](https://img.shields.io/badge/version-2.5.0-0e9aa7?style=for-the-badge)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-0b2a3a?style=for-the-badge)
![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Salesforce](https://img.shields.io/badge/Salesforce-OAuth%202.0-00A1E0?style=for-the-badge&logo=salesforce&logoColor=white)
![Internal](https://img.shields.io/badge/CYFOR-Internal%20Tool-0b2a3a?style=for-the-badge)

</div>

<!-- 📸 Optional banner: drop an image at docs/screenshots/banner.png and uncomment:
<p align="center"><img src="docs/screenshots/banner.png" alt="CYFOR Nucleus Enhancer" width="820"></p>
-->

---

> **What is it?** A Chrome (Manifest V3) extension that layers time‑saving tools on top of Salesforce/Nucleus Lightning — one‑keystroke template insertion, a centrally‑managed template library synced from Salesforce, record navigation, notes formatting, column presets, and a one‑click sanitised case‑report export. Install it, click **Connect Salesforce**, and go.

---

## ✨ Highlights

| | Feature | What it does |
|---|---|---|
| ⚡ | **Instant templates** | Drop standardised text (incl. Forensic Strategy) into any Notes / rich‑text field via **Alt+T**, a right‑click menu (with search + categories), or a floating button. **Alt+Z** undoes it. |
| ☁️ | **Official templates from Salesforce** | Your team's approved templates sync down automatically and are badged **Official** — users can't accidentally override them. |
| 🗂️ | **Template Manager** | A full dashboard to create, edit, version, review and assign templates across teams — all stored in Salesforce. |
| 🕘 | **Version history & diff** | Every change is snapshotted with who / when / why, viewable as a side‑by‑side diff and exportable to CSV. |
| 🔔 | **Review tracking** | Surfaces templates that are overdue or due for review, so nothing lapses. |
| 🧭 | **Record navigation** | Jump between Exhibit Process records with **Alt+← / Alt+→**. |
| 🕓 | **Right‑click Date/Time** | Fill Lightning date/time pickers with the current timestamp in one click. |
| 📝 | **Notes formatting** | Expand concatenated list‑view notes into readable blocks. |
| ↔️ | **Column presets** | Drag‑reorder Lightning datatable columns and save reusable presets. |
| 📄 | **Case Disclosure Report** | One‑click, commercially‑sanitised HTML report for a Forensic Case, with a **Save as PDF** print view. |
| 🎨 | **Auto / Light / Dark** | A theme that follows your choice everywhere — popup, manager **and** the in‑page UI — and updates live with no refresh. |

---

## 🚀 Getting started (everyday users)

You don't need to set up anything technical — just:

1. **Install** the extension (see [Developer setup](#-developer-setup) if you're loading it yourself).
2. Open the extension popup and click **Connect Salesforce** — a normal Salesforce login window appears, and that's the only setup you'll ever do.
3. In any **Notes** or **Forensic Strategy** field, press **Alt+T** (or right‑click) to insert a template. That's it. 🎉

> 💡 Your team's official templates appear automatically and stay up to date in the background — no manual syncing required (though there's a **Sync Now** button if you're impatient).

<!-- 📸 Screenshot: docs/screenshots/popup.png — the extension popup -->

### ⌨️ Keyboard shortcuts

| Shortcut | Action |
|:--:|---|
| **Alt + T** | Open the template menu in the active editor |
| **Alt + Z** | Undo the last template insertion |
| **Alt + ← / →** | Navigate between records |

Rebind any of these via the popup's **Customise…** link (opens `chrome://extensions/shortcuts`).

---

## 🗂️ Template Manager

A polished, full‑page dashboard for template admins — everything lives in Salesforce, so the extension is just a faster way to manage it.

- **Sidebar dashboard** — Templates · Reviews · Usage · Settings, with at‑a‑glance stats (active, due soon, overdue, teams).
- **Create / edit / delete** any team's templates, and **assign** them to any team or **Global** (all teams).
- **Version control** — minor/major bumps, status lifecycle (Draft → Active → Under Review → Superseded → Retired), effective & review‑due dates, and a required change reason for the audit trail.
- **History & diff** — browse past versions, compare any two side‑by‑side, search/filter, and export to CSV.
- **Reviews** — a dedicated view of everything overdue or due within 30/60 days.
- **Audit** — each change records the signed‑in user (name + email) and timestamp.
- **Open in Salesforce** — every template links straight to its underlying record.

> Only **Active** templates publish to analysts, so drafts and retired items never reach the floating menu.

<!-- 📸 Screenshot: docs/screenshots/manager.png — the Template Manager dashboard -->

---

## 🛡️ Admin & Salesforce setup

The extension reads/writes a small set of custom objects in your org:

| Object | Purpose |
|---|---|
| `NucleusTemplate__c` | The templates themselves (content, status, team, version, review dates…). |
| `NucleusTemplateVersion__c` | One record per archived revision (version history). |
| `NucleusTeam__c` | Teams used for scoping templates. |
| `NucleusTeamMember__c` | Team membership + the per‑team **template admin** flag. |

Field **API names are auto‑detected** from each object's describe, so they don't need to match exactly — the extension adapts to whatever your admin created.

### 🔑 Admin permissions (delete & manage templates)

The extension acts **as the signed‑in user** over OAuth, so it can only do what that user can do in Salesforce. Two object permissions matter for managing templates — set them on the template‑admin **permission set** (Permission Set → Object Settings → each object):

| To do this | Grant on `NucleusTemplate__c` | Grant on `NucleusTemplateVersion__c` |
|---|---|---|
| **Delete a template that has version history** (the manager removes its child version records first, so the parent's restrict‑delete lookup lets go) | Delete | **Delete** |
| **Edit/delete templates owned by anyone** (incl. people who've left) | **Modify All** | **Modify All** |

Notes:
- **Delete on `NucleusTemplateVersion__c` is required to delete *any* template that has been edited** — even your own. Without it you'll see *"Couldn't delete this template's version history…"*. This is the most common gotcha.
- **Modify All** (preferred over the org‑wide *Modify All Data*) lets admins manage every team's templates regardless of record owner, which is what the manager's all‑teams admin view is built for, and covers the "owner left the company" case.

### 🕘 Version history (full Salesforce parity ✅)

Every change to a template is snapshotted to `NucleusTemplateVersion__c` (with who / when / why), shown in the History tab with a side‑by‑side diff.

Archiving is handled by a **record‑triggered Flow** in Salesforce, so it captures **every** edit from **any** source — through the Template Manager *or* directly in Salesforce — as a single, complete trail. The extension no longer archives itself, so each edit creates exactly one snapshot, and "Changed By / When" comes from the standard Salesforce **Created By / Created Date**.

➡️ Flow build reference: **[docs/salesforce-version-history-flow.md](docs/salesforce-version-history-flow.md)**

---

## 🔒 Security & architecture

- **No credentials in the extension.** Salesforce OAuth runs through a **Cloudflare Worker proxy** ([oauth-proxy/](oauth-proxy/)); the Consumer Key & Secret live only as Cloudflare secrets and are never shipped or committed.
- **Hardened proxy** — CORS origin lock, server‑side redirect‑URI check, per‑IP rate limiting, input validation, and a minimum‑client‑version gate.
- **Light on infrastructure** — template data is fetched **directly from Salesforce**, not through the worker, so the worker only ever handles the occasional OAuth token refresh.
- **Always current** — a tightly‑gated background sync keeps every connected device up to date within ~20 minutes (only while a Salesforce tab is open), and the in‑page menu updates live.
- SOQL values are escaped/validated, and the disclosure report escapes all field data before rendering.

---

## 🧑‍💻 Developer setup

> One‑time setup for whoever builds/deploys the extension. **End users never do this.**

<details>
<summary><b>1 · Configure the proxy URL</b></summary>

```bash
cp config.example.js config.js
# edit config.js → set oauthProxyUrl to your Cloudflare Worker URL
```
`config.js` is gitignored — the proxy URL isn't secret, but keep local overrides out of git.
</details>

<details>
<summary><b>2 · Deploy the Cloudflare Worker (holds the secrets)</b></summary>

```bash
cd oauth-proxy
wrangler deploy
wrangler secret put SF_CLIENT_ID       # Salesforce Consumer Key
wrangler secret put SF_CLIENT_SECRET   # Salesforce Consumer Secret
wrangler secret put SF_INSTANCE_URL    # e.g. https://cyfor.my.salesforce.com
```
Hardening (origin lock, redirect check, rate limit, version gate) is configured in [oauth-proxy/wrangler.toml](oauth-proxy/wrangler.toml). **Reload the extension to the matching version *before* deploying** if the version gate is enabled.
</details>

<details>
<summary><b>3 · Load the extension</b></summary>

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. The extension ID is pinned by the manifest `key`, so it stays stable across reloads.
</details>

---

## 📁 Project structure

| Path | Purpose |
|---|---|
| [content/](content/) | Content scripts injected into Lightning pages (templates, notes, navigation, columns, theme) |
| [background.js](background.js) · [background/](background/) | Service worker + Salesforce modules (OAuth, templates, teams, versions, sync) |
| [popup/](popup/) | Browser‑action popup |
| [manager/](manager/) | Full‑page Template Manager (options page) |
| [report/](report/) | Disclosure‑report generator + live case fetch |
| [styles/](styles/) | Shared CSS — design tokens, theming, the custom dropdown, and the injected UI |
| [oauth-proxy/](oauth-proxy/) | Cloudflare Worker OAuth proxy |
| [docs/](docs/) | Admin/setup docs (e.g. the version‑history Flow) |

---

## 🧪 Troubleshooting

| Symptom | Fix |
|---|---|
| A code change didn't take effect | Content scripts & the service worker only update on a **full extension reload** (`chrome://extensions` → ↻), not a page refresh. Open pages (popup/manager) need their tab reloaded too. |
| Login fails after a worker change | Confirm the extension ID on `chrome://extensions` matches `ALLOWED_ORIGIN` / `ALLOWED_REDIRECT_PREFIX` in `wrangler.toml`, then `wrangler deploy`. |
| "Export Case Report" button missing | Open a **Forensic Case** record — it docks into the highlights action bar and re‑injects on re‑render. |
| Templates look out of date | Hit **Sync Now** in the popup, or wait for the next background sync (~20 min, while a Salesforce tab is open). |

---

## 🗺️ Roadmap

- **MG22A / MG22B report generation** — auto‑prefilled Word reports from live case data. Built and feature‑flagged **off** for now (owned by a teammate); see the `OWNED BY MITUL` banners in the code.

---

<div align="center">

**CYFOR Group — internal tooling.** Built for the digital‑forensics floor. 🔬

</div>
