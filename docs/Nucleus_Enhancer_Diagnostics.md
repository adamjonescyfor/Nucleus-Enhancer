# Diagnostics & debug cheat-sheet — CYFOR Nucleus Enhancer

A practical reference for diagnosing problems during validation/testing. Copy-paste the commands as needed. Nothing here changes behaviour for normal users — debug logging is **off by default**.

---

## 1. The two consoles

The extension runs in two places, each with its own console:

| Console | What runs there | How to open |
|---|---|---|
| **Page console** | The injected content scripts (templates, right-click, notes, insertion…) | On the Salesforce tab: **F12** → **Console** |
| **Service-worker console** | `background.js` (OAuth, template sync, CRUD, usage logging) | `chrome://extensions` → **CYFOR Nucleus Enhancer** → **Inspect views: service worker** |

Content-script logs appear in the **page** console; background logs appear in the **service-worker** console. Filter either with `[Cyfor` to see only ours.

---

## 2. Turn debug logging on / off

**The easy way (no DevTools): the popup.** Open the extension popup → **Diagnostics** → switch on **Capture diagnostic log**. Then **refresh the Salesforce tab** and reproduce the issue / run your tests. Come back to the popup and click **Download log** to save a `.txt` file you can send to support. **Clear** starts a fresh capture; switching the toggle on also clears automatically.

> **Safety net:** if you forget to switch it off, diagnostics **auto-disables and bins its buffer after 24 hours** — it can never keep logging (or hold storage) indefinitely. The buffer is also hard-capped at 2,000 events. Just flip it on again if you need another session.

> Workflow for validation: the **spreadsheet** is your record of Pass/Fail. The diagnostics log is an optional *extra* — turn it on while testing so that, if anything fails or looks odd, the downloaded file gives the technical detail to diagnose it. You don't need to read the log yourself.

**The manual way (advanced):** the toggle just sets a storage flag, `cyforDebug`. You can set it directly in the **service-worker console**:

```js
// ON
chrome.storage.local.set({ cyforDebug: true });
// OFF
chrome.storage.local.set({ cyforDebug: false });
```

Then **refresh the Salesforce tab**. Either way you'll also see live prefixed lines in the consoles, like:

```
[Cyfor:insert]   rich template { name: "Forensic Strategy", method: "paste", chars: 812 }
[Cyfor:rightclick] field resolved { tag: "INPUT", cls: "…", usedDownField: false }
[Cyfor:rightclick] exhibit-type marker { name: "…SIM…", marker: "sim", type: "SIM Card" }
[Cyfor:sync]     team-scoped templates { count: 12, teamCode: "DF", multiTeamField: "Teams__c", contentMax: 32768 }
[Cyfor:crud]     update { name: "…", multiTeam: true, teams: "DF;CYBER", status: "Active" }
[Cyfor:usage]    org write { ok: true }
```

### What each area means
| Prefix | Where | Tells you |
|---|---|---|
| `[Cyfor:insert]` | page | Which insertion path was used (`paste` = Quill paste pipeline, `insertHTML`/`insertText(plain)`/`innerHTML` = fallbacks) and the character count. If rich content is being lost, check `method`. |
| `[Cyfor:rightclick]` | page | Which field the right-click resolved to, whether the zoom-proof `downField` fallback was used, and the exhibit-type marker→type decision. |
| `[Cyfor:templates]` | page | Template menu populated (count, whether it's the Forensic Strategy field). |
| `[Cyfor:nav]` | page | Record navigation: `list from cache`/`from click` + count, `preload start`/`done` (lazy-load of big lists), and `navigate` target. If a position count looks wrong, check the list size here. |
| `[Cyfor:cases]` | page + SW | Case project/alias: how many aliases were asked for vs found. If aliases don't appear, check the org has a "Project" field readable by the user. |
| `[Cyfor:usage]` | page + SW | Local record route (`flush`/`defer`) and the org-write outcome. |
| `[Cyfor:sync]` | SW | Team-scoped sync result: template count, the user's team code, whether the multi-team field was detected, and the Content field's max length. |
| `[Cyfor:crud]` | SW | Each create/update: name, multi-team mode, the team codes written, status. |
| `[Cyfor:acks]` | SW | A read-acknowledgement being recorded (template id + version). |
| `[Cyfor:changes]` | SW | An edit suggestion being submitted, or resolved (approved / rejected). |

---

## 3. Inspect state (service-worker console)

```js
// Everything the extension has stored locally
chrome.storage.local.get(null, console.log);

// Who you're signed in as (team, admin flag)
chrome.storage.local.get('sfOAuthUser', r => console.log(r.sfOAuthUser));

// The synced templates + when they last synced
chrome.storage.local.get(['sfRemoteTemplates','sfTemplatesSyncedAt'],
  r => console.log(Object.keys(r.sfRemoteTemplates||{}).length, 'templates · synced',
                   new Date(r.sfTemplatesSyncedAt)));

// Last org-usage write error (only set while the last write FAILED)
chrome.storage.local.get('usageLogError', r => console.log(r.usageLogError || 'none'));

// Synced bits (theme, pinned templates, onboarding flags). Feature toggles are
// per-device in chrome.storage.local, not synced.
chrome.storage.sync.get(null, console.log);
```

### Force a fresh template sync
Run in the **service-worker** console — call the module directly. (Do **not** use
`chrome.runtime.sendMessage` here: from the worker it targets *other* contexts, not the
worker's own listener, so it throws `Could not establish connection. Receiving end does
not exist.` — harmless, but it does nothing. `sendMessage` only works from the popup or a
content script.)
```js
self.SfTemplates.fetchRemoteTemplates(true).then(console.log);
```

### Re-check the admin/all-teams dataset (what the manager loads)
```js
self.SfTemplates.fetchAllTemplatesForAdmin()
  .then(r => console.log(r.ok, 'fields:', r.fields, 'count:', Object.keys(r.templates||{}).length));
```
`fields.teamsMulti` tells you whether the multi-team picklist was found; `fields.contentMaxLength` is the Content field's real limit.

---

## 4. Common symptoms → first check

| Symptom | First check |
|---|---|
| Template inserts but **content is lost after the first block** | `[Cyfor:insert]` `method`. `paste` should keep everything; if it's falling back to `insertHTML`, the synthetic paste was blocked — capture the page console. |
| Right-click shows the **native browser menu** instead of acting | Page zoom — set the browser to **100%** (zoom shifts `elementFromPoint`). Confirm `[Cyfor:rightclick] field resolved` fires. |
| **No templates** in the menu / "0 loaded" | Connection (`sfOAuthUser`), then `[Cyfor:sync]` count. `0` with a team code → check the team has Active templates + the user's `NucleusTeamMember__c` record. |
| Manager shows **"Not connected"** / permission denied | `sfOAuthUser.isTemplateAdmin`. Admin needs **both** `IsAdmin__c` on their Team Member record **and** the permission set (see admin guide). |
| Connect fails with **`STATE_MISMATCH`** in the service-worker console | The OAuth proxy isn't echoing the CSRF `state` back. Re-deploy the worker (`cd oauth-proxy && wrangler deploy`) — its `/auth-url` handler must pass `state` through to Salesforce. |
| **Multi-team** picker not appearing | `fields.teamsMulti` from `listAll` (section 3). `null` = the `Teams__c` field doesn't exist yet / FLS hides it. |
| Save fails **"data value too large"** | Content > the field limit (`fields.contentMaxLength`, ~32 KB). The editor's character counter shows it live. |
| Usage log empty in the manager | If org-wide: `usageLogError` (object must be **Deployed**, not "In Development"). Local log is per-device only. |
| Service-worker page shows **"An unknown error occurred when fetching the script"** | Benign for unpacked/dev-mode extensions on Edge — it does not indicate a code fault. Confirm the worker still responds (run any command in section 3). |

---

## 5. Verifying British formatting

All user-facing dates/times must be **British**: dates `DD/MM/YYYY`, times 24-hour `HH:MM`. Spot-check:
- Right-click a date field → toast `Date set to 20/06/2026` (not `06/20/2026`).
- Right-click a time field → toast `Time set to 14:30` (not `2:30 PM`).
- `{{date}}` / `{{time}}` / `{{dateTime}}` in an inserted template.
- Manager **Usage** "When" column and **Review Due** dates.
- Manager **version history** "Archived" timestamps.

---

## 6. After making code changes
Code changes need a **full extension reload** (`chrome://extensions` → ↻ on the card), **not** just a page refresh — then refresh the Salesforce tab. Manifest changes (e.g. a new content script) always require the reload.
