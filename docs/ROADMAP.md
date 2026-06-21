# Roadmap — CYFOR Nucleus Enhancer

Implementable backlog beyond v3.0. Each item is specced so a developer (or future AI session) can build it without re-deriving context. Ordered within each wave by impact ÷ effort. **Hard rules that always apply:** Salesforce field API names are describe-discovered (never hardcode); OAuth secrets stay in Cloudflare; `report/disclosure-report.js` + `styles/case-report.css` are the CTO's (don't edit); the MG22 feature is Mitul's (flagged off via `MG22_ENABLED` in `content/case-report.js`).

## Wave 2 (next)

### ✅ DONE 2026-06-12: bulk operations · dropdown typeahead · review-due notifications · packaging script
Bulk ops live in the manager (checkbox column + bulk bar: set status / move team / delete, sequential with progress + failure report; metadata-only updates so no version snapshots). Typeahead in `styles/custom-select.js` upgrades every themed dropdown (incl. popup Quick Insert). Review nudges: after a successful background sync, admins get at most one `chrome.notifications` per day when templates are overdue/due ≤30d (click opens the manager). `scripts/pack.sh` produces the runtime-only release zip (refuses without config.js).

### ✅ DONE 2026-06-20: multi-team assignment · rich-text editor · live theme · faithful insertion
A template can now be assigned to **several teams** (not just one or Global) via a multi-select picklist (`Teams__c`, values = team codes) — auto-detected from the describe, fully backward-compatible with the single `Team__c` lookup, with a checkbox picker in the manager. Salesforce setup: the `Teams__c` field + read FLS + one-time migration ([admin guide](salesforce-admin-guide.md#multi-team-assignment-optional--one-template-visible-to-several-teams)). Also shipped: rich-text template editor (toolbar, paste-from-Word, live selection readout, character counter against the 32 KB Content limit, file-picker image auto-fit); live theme switching across popup + manager + injected UI; faithful insertion into Salesforce's Quill (div→p, indent-list repair, synthetic-paste); the "Sense Check" process type; right-click auto-fill (exhibit type / forensic case / staff).

### ✅ DONE 2026-06-21: multi-team membership
A user can belong to **more than one team**. `background/sf-team.js` `fetchUserTeamInfo` now fetches ALL active memberships → `sfOAuthUser.teams = [{teamId, teamName, teamCode, isAdmin}]` (the single primary-team fields are kept as-is for backward-compat). `background/sf-templates.js` `buildQuery` scopes templates to ALL the user's codes (`Team__r.TeamCode__c IN (…)` **+** `Teams__c INCLUDES (…)`), so a single-team user is unchanged (one-element `IN`). Admin = admin in ANY team. Popup + manager identity show "Team A · Team B". **No new SF field** — the admin just creates one `NucleusTeamMember__c` record per team for the user (see [admin guide](salesforce-admin-guide.md)). Per-team admin gating (finer than admin-in-any) is still possible later if wanted.

### manager.js modularisation — M (mechanical)
manager.js is ~1,700 lines (bulk ops added). Extension pages share globals across `<script>` tags, so split without a module system: extract `manager-history.js` (openHistory → diff/CSV/compare) , `manager-editor.js` (openNewEditor/openEditEditor/openCloneEditor/saveTemplate/updateEditorVersionUI) and `manager-views.js` (render*). Load order in manager.html: helpers first, manager.js (init) last. Pure cut-and-paste; verify with node --check + a full manual pass. Do post-rollout — zero user-visible value, real regression surface.

### Worker housekeeping (bundle with the next `wrangler deploy`) — S
1. Add CORS headers to the 405 method-check response in `oauth-proxy/worker.js` (cosmetic consistency). 2. AFTER the whole company is confirmed on ≥3.1: raise `MIN_CLIENT_VERSION` in `wrangler.toml` to retire old builds (recovery: set to `""` and redeploy).

## Wave 3 (later / needs Salesforce work)

### ✅ DONE 2026-06-21: Read-acknowledgement QMS
"I have read and understood v2.1" per analyst per **controlled** template — real UKAS value. `background/sf-acks.js` (describe-discovered): the analyst gets an Acknowledge chip + banner + an "I have read & understood vX" button in the manager; a new version resets it; admins get an **Acknowledgements matrix** tab (who's outstanding per controlled template, scoped to the assigned teams); analysts get a once-a-day in-app nudge for outstanding acks. **Manageability:** only templates with the `RequiresAck__c` checkbox need sign-off (opt-in, no day-1 avalanche). **Salesforce setup:** `NucleusTemplateAck__c` (Template lookup + Version_Label__c) + the `RequiresAck__c` checkbox + FLS — full spec in [salesforce-ack-object.md](salesforce-ack-object.md). Optional email push = a Salesforce Flow (spec'd in that doc); the extension can't/shouldn't send email.

### ✅ DONE 2026-06-21: Suggest-an-edit (change-request workflow)
Analysts propose template edits; admins review and Apply/Reject. `background/sf-changes.js` (describe-discovered): members get a **Suggest edit** button → a box prefilled with the current content + a reason; admins get a **Suggestions** tab (count badge) with a **diff** (suggested vs current), **Apply** (marks the request Approved and opens the editor prefilled, so the admin finalises formatting and Saves through the normal versioned update) and **Reject**; admins also get a once-a-day in-app nudge for pending suggestions. **Salesforce setup:** `NucleusTemplateChangeRequest__c` (Template lookup + Proposed_Content + Reason + Status [+ optional Admin_Note]) + permissions — full spec in [salesforce-change-request-object.md](salesforce-change-request-object.md).

### MG22 handover (Mitul) — doc exists in memory; owner: Mitul
Pipeline is built and flagged off: docx fill engine (`lib/docx-fill.js` incl. `{#devices}` loops), field mapping (`report/mg-extract.js`, verified against LP-26-00049), template storage spec (`NucleusReportTemplate__c`), MG21 parser (regex needs tuning against a real MG21). Remaining: the Salesforce admin creates the object + uploads the 5 tagged templates (in ~/Downloads as of 2026-06), flip `MG22_ENABLED = true`, tune MG21 regex, then photo-OCR/force-auto-select as stretch.

### Misc
- README screenshots + GitHub social banner (placeholders are HTML comments in README).
- Insert preview-before-insert (hover preview exists in both menus; a "confirm large template" step only if users ask).
- Protected-token list growth for the notes parser (`content/notes-data.js` `protectedTokens`) as new brand names appear in real notes.

## Done (for context)
v3.1: read-only manager for non-admins; What's New + first-use tip + Help; popup restructure + config hiding; pins/recents/new variables; clone-as-draft; org-usage client. v3.0: version-history Flow handover; delete cascade; metadata-only edits; content-script self-heal; notes parser overhaul; perf/security/a11y audits.
