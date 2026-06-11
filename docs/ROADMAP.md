# Roadmap — CYFOR Nucleus Enhancer

Implementable backlog beyond v3.0. Each item is specced so a developer (or future AI session) can build it without re-deriving context. Ordered within each wave by impact ÷ effort. **Hard rules that always apply:** Salesforce field API names are describe-discovered (never hardcode); OAuth secrets stay in Cloudflare; `report/disclosure-report.js` + `styles/case-report.css` are the CTO's (don't edit); the MG22 feature is Mitul's (flagged off via `MG22_ENABLED` in `content/case-report.js`).

## Wave 2 (next)

### Bulk operations in the Template Manager — M
Multi-select rows (leading checkbox column in `renderTemplateList`, manager.js) + a selection toolbar that appears above the table: **Set status…**, **Move to team…**, **Delete selected**. Each runs the existing `sfTemplates.update`/`sfTemplates.delete` messages sequentially with a progress count in the toolbar, then one `loadTemplates()`. Confirm via `mgrModal` listing the affected names. Keep per-row failures non-fatal (collect + report at the end). Respect `readOnly` (no checkboxes for members).

### Multi-team membership — M
`background/sf-team.js` `fetchUserTeamInfo` uses `LIMIT 1` — a user in two teams only sees one. Change the query to fetch ALL active memberships → `sfOAuthUser.teams = [{teamId, teamName, teamCode, isAdmin}]` (keep the existing single-team fields as the primary for compatibility). `background/sf-templates.js` `buildQuery` team filter becomes `(Team__c = null OR Team__r.TeamCode__c IN (…escaped codes…))`. Popup identity line shows "Team A · Team B". Admin flag = admin in ANY team (or per-team gating if Callum wants finer control — ask).

### manager.js modularisation — M (mechanical)
manager.js is ~1,400 lines. Extension pages share globals across `<script>` tags, so split without a module system: extract `manager-history.js` (openHistory → diff/CSV/compare, ~350 lines) and `manager-editor.js` (openNewEditor/openEditEditor/openCloneEditor/saveTemplate/updateEditorVersionUI). Load order in manager.html: helpers first, manager.js (init) last. Pure cut-and-paste; verify with node --check + a full manual pass.

### Popup template search + custom-select typeahead — S
The popup Quick Insert list is a plain dropdown; with 50+ templates it needs search. Add type-to-filter inside `styles/custom-select.js` (buffer keystrokes in the open menu, filter `.cyf-cs-item` visibility; Esc clears) — this upgrades EVERY themed dropdown (manager compare pickers too) for free.

### Review-due notifications — S/M
The background already computes nothing on a schedule besides sync. On the existing `cyforTemplateSync` alarm, after a successful admin sync, compute overdue/due-30 counts (same logic as manager `reviewSnapshot`) and, if non-zero and changed since last notify (storage flag), fire a `chrome.notifications.create` ("3 templates overdue for review — open Template Manager"). Needs `notifications` permission. Admins only (check `sfOAuthUser.isTemplateAdmin`).

### Release packaging script — S
`scripts/pack.sh` (or node): zip ONLY runtime files (manifest.json, background.js, background/, content/, popup/, manager/, report/, styles/, lib/, config.js) into `cyfor-nucleus-enhancer-<version>.zip`. Excludes `oauth-proxy/`, `docs/`, `*.md`, `.git*`, `config.example.js`. Refuse to run if `config.js` is missing (end-user builds need the compiled proxy URL).

### Worker housekeeping (bundle with the next `wrangler deploy`) — S
1. Add CORS headers to the 405 method-check response in `oauth-proxy/worker.js` (cosmetic consistency). 2. AFTER the whole company is confirmed on ≥3.1: raise `MIN_CLIENT_VERSION` in `wrangler.toml` to retire old builds (recovery: set to `""` and redeploy).

## Wave 3 (later / needs Salesforce work)

### Read-acknowledgement QMS — L
"I have read and understood v2.1" per analyst per template — real UKAS value. Needs a Salesforce object (`NucleusTemplateAck__c`: Template lookup, Version_Label__c, CreatedBy = the acknowledger) + UI: members see an "Acknowledge" button in the read-only viewer; admins see an acknowledgement matrix (who's outstanding per template) in the manager. Spec the object for Callum first; the describe-discovery + dormant-client pattern from `background/sf-usage.js` is the template to copy.

### Change-request workflow — L
Members propose template edits (new object `NucleusTemplateChangeRequest__c` with proposed content + reason); admins review in the manager (diff against current via the existing `showDiff`), approve → runs the normal update path. Only worth it if admins report change-by-email pain after rollout.

### MG22 handover (Mitul) — doc exists in memory; owner: Mitul
Pipeline is built and flagged off: docx fill engine (`lib/docx-fill.js` incl. `{#devices}` loops), field mapping (`report/mg-extract.js`, verified against LP-26-00049), template storage spec (`NucleusReportTemplate__c`), MG21 parser (regex needs tuning against a real MG21). Remaining: Callum creates the object + uploads the 5 tagged templates (in ~/Downloads as of 2026-06), flip `MG22_ENABLED = true`, tune MG21 regex, then photo-OCR/force-auto-select as stretch.

### Misc
- README screenshots + GitHub social banner (placeholders are HTML comments in README).
- Insert preview-before-insert (hover preview exists in both menus; a "confirm large template" step only if users ask).
- Protected-token list growth for the notes parser (`content/notes-data.js` `protectedTokens`) as new brand names appear in real notes.

## Done (for context)
v3.1: read-only manager for non-admins; What's New + first-use tip + Help; popup restructure + config hiding; pins/recents/new variables; clone-as-draft; dormant org-usage client. v3.0: version-history Flow handover; delete cascade; metadata-only edits; content-script self-heal; notes parser overhaul; perf/security/a11y audits.
