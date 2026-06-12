# Roadmap — CYFOR Nucleus Enhancer

Implementable backlog beyond v3.0. Each item is specced so a developer (or future AI session) can build it without re-deriving context. Ordered within each wave by impact ÷ effort. **Hard rules that always apply:** Salesforce field API names are describe-discovered (never hardcode); OAuth secrets stay in Cloudflare; `report/disclosure-report.js` + `styles/case-report.css` are the CTO's (don't edit); the MG22 feature is Mitul's (flagged off via `MG22_ENABLED` in `content/case-report.js`).

## Wave 2 (next)

### ✅ DONE 2026-06-12: bulk operations · dropdown typeahead · review-due notifications · packaging script
Bulk ops live in the manager (checkbox column + bulk bar: set status / move team / delete, sequential with progress + failure report; metadata-only updates so no version snapshots). Typeahead in `styles/custom-select.js` upgrades every themed dropdown (incl. popup Quick Insert). Review nudges: after a successful background sync, admins get at most one `chrome.notifications` per day when templates are overdue/due ≤30d (click opens the manager). `scripts/pack.sh` produces the runtime-only release zip (refuses without config.js).

### Multi-team membership — M
`background/sf-team.js` `fetchUserTeamInfo` uses `LIMIT 1` — a user in two teams only sees one. Change the query to fetch ALL active memberships → `sfOAuthUser.teams = [{teamId, teamName, teamCode, isAdmin}]` (keep the existing single-team fields as the primary for compatibility). `background/sf-templates.js` `buildQuery` team filter becomes `(Team__c = null OR Team__r.TeamCode__c IN (…escaped codes…))`. Popup identity line shows "Team A · Team B". Admin flag = admin in ANY team (or per-team gating if Callum wants finer control — ask). Deferred pre-rollout: touches access scoping.

### manager.js modularisation — M (mechanical)
manager.js is ~1,700 lines (bulk ops added). Extension pages share globals across `<script>` tags, so split without a module system: extract `manager-history.js` (openHistory → diff/CSV/compare) , `manager-editor.js` (openNewEditor/openEditEditor/openCloneEditor/saveTemplate/updateEditorVersionUI) and `manager-views.js` (render*). Load order in manager.html: helpers first, manager.js (init) last. Pure cut-and-paste; verify with node --check + a full manual pass. Do post-rollout — zero user-visible value, real regression surface.

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
