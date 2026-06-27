#!/usr/bin/env python3
# Generates the CYFOR Nucleus Enhancer Validation Results workbook as a Flat ODS
# (.fods) — multiple sheets, colour-coded result column, a Pass/Fail/... dropdown,
# and a summary with live formulas. Convert to .xlsx with LibreOffice:
#     soffice --headless --convert-to xlsx --outdir docs tools/validation/results.fods
# Re-run this script to regenerate after editing the test cases below.

import html

OUT = "tools/validation/results.fods"

# ─────────────────────────────────────────────────────────────────────────────
# Test cases: (AREA, FEATURE, PRIORITY, PRECONDITION, [STEPS...], EXPECTED)
# Grouped by area; a section header row is emitted whenever AREA changes.
# ─────────────────────────────────────────────────────────────────────────────
H, M, L = "High", "Medium", "Low"
CASES = [
 # ── Install & load ──
 ("Install & load","Extension loads",H,"Unpacked build loaded","Open chrome://extensions","Card shows, no errors; 'service worker' active (not 'errored')"),
 ("Install & load","Content scripts inject",H,"On a Salesforce Lightning page","Open a Forensic Case / Exhibit Process record","Injected UI appears (📄 button in Notes, nav arrows where applicable); page console shows no [Cyfor] errors"),
 ("Install & load","Self-heal on update",M,"A Salesforce tab already open","Reload the extension (chrome://extensions ↻) WITHOUT refreshing the tab","Injected features keep working / re-attach without a manual page refresh"),
 ("Install & load","Service-worker fetch notice",L,"Edge extensions page","Inspect the extension card","Any 'unknown error fetching the script' is benign for unpacked builds; the worker still responds to a test command (Diagnostics §3)"),
 # ── Popup — connection ──
 ("Popup — connection","Initial state",H,"Extension installed","Open the popup before connecting","Header 'Nucleus Enhancer' + version; connection shows 'Checking…' then 'Not connected'"),
 ("Popup — connection","Connect Salesforce",H,"Valid SF login","Click 'Connect Salesforce', complete OAuth","Returns connected: avatar, name, email; badge flips to connected"),
 ("Popup — connection","Sync now",H,"Connected","Click 'Sync Now'","Status shows syncing then 'N official templates · Last synced just now'"),
 ("Popup — connection","Disconnect",M,"Connected","Click 'Disconnect'","Returns to 'Not connected'; Quick Insert official count drops"),
 ("Popup — connection","Offline handling",M,"Disconnected / no network","Open popup","No crash; clear not-connected state; Quick Insert still lists local templates only"),
 # ── Quick Insert ──
 ("Quick Insert","Loaded count",M,"Templates synced/uploaded","Open popup Quick Insert","Badge shows 'N loaded'; dropdown 'Select template…' lists templates A–Z"),
 ("Quick Insert","Insert into active tab",H,"On a SF Notes/Forensic Strategy field; template selected","Click 'Insert into Active Tab'","Template inserted into the active editor; popup closes; status '\"name\" sent ✓'"),
 ("Quick Insert","Insert with no editor",M,"Not on an editor field","Click Insert","Clear message e.g. 'Navigate to a Salesforce page first' / 'click inside the Notes…'"),
 ("Quick Insert","Pin / unpin",M,"Template selected","Click ☆","Toggles ☆/★; pinned templates appear first in every menu; persists after reopen"),
 ("Quick Insert","Preview",L,"Template selected","Click 'Preview'","Preview pane shows up to ~400 chars; closes with ✕"),
 ("Quick Insert","Edit local vs official",M,"Select an Official template","Click 'Edit'","Editor opens read-only with note that official templates are managed in Salesforce; Save disabled"),
 # ── Core-feature toggles ──
 ("Core toggles","Right-Click Quick-Fill",M,"Popup open","Toggle off, test a date field; toggle on","Off = native menu; On = quick-fill works; state persists"),
 ("Core toggles","Right-Click Template Menu",M,"Popup open","Toggle off/on, right-click in Notes","Off = no template menu; On = menu appears; persists"),
 ("Core toggles","Nav Arrows",L,"On Exhibit Process","Toggle off/on","Arrows/shortcuts disabled/enabled accordingly"),
 ("Core toggles","Format List Notes",L,"List view with notes","Toggle off/on","Notes formatting applied only when on"),
 ("Core toggles","Smart Auto-Insert",L,"New record form","Toggle on; open empty Notes on a mapped process","Template auto-inserted (toast 'Auto-inserted …'); off = suggestion only"),
 # ── Columns / presets ──
 ("Columns","Detect columns",L,"List view open","Open popup Table Columns","Current table's columns listed; 'Scanning…' resolves"),
 ("Columns","Reorder + reset",M,"Columns listed","Drag to reorder; then 'Reset'","Table follows the drag live; Reset returns BOTH the live table AND the popup list to Salesforce's natural order"),
 ("Columns","Save / load / overwrite preset",L,"Reordered","Save Preset (name it); reorder differently; Load the preset from the dropdown; re-save under the same name","Load APPLIES instantly to the live table (not just a popup preview); re-saving an existing name asks to confirm overwrite"),
 # ── Process mappings ──
 ("Process mappings","Map process→template",L,"Templates loaded; Sense Check type exists","Expand Process → Template Mappings; map a type incl. 'Sense Check'","Mapping saved; used by Smart Auto-Insert/suggestion"),
 # ── Template upload ──
 ("Template upload","Upload local .txt",L,"Have .txt files","Select Template Folder","'N user templates loaded · M official'; official always win name clashes"),
 ("Template upload","Clear all",L,"Local templates loaded","Click 'Clear All Templates'","Local templates removed; official remain"),
 # ── Theme ──
 ("Theme","Picker Auto/Light/Dark",M,"Popup open","Click each theme option","Popup restyles immediately; selected button pressed-state"),
 ("Theme","Live switch to manager",H,"Manager open in another tab","Change theme in popup","Open manager re-themes live with NO refresh"),
 ("Theme","Live switch to page UI",M,"SF page open","Change theme","Injected UI (menus/toasts) follows the theme"),
 ("Theme","Auto follows OS",L,"Theme = Auto","Change OS light/dark","Surfaces follow the OS without refresh"),
 # ── Banners / help ──
 ("Banners","Welcome banner",L,"First run","Open popup","'Welcome to Nucleus Enhancer 👋' shows; dismiss persists"),
 ("Banners","What's New",L,"After update","Open popup","'What's new' shows once; dismiss persists"),
 ("Banners","Help & tips",L,"Popup open","Expand Help & tips","All listed tips accurate to current behaviour"),
 # ── Right-click date/time/status/lookups ──
 ("Right-click","Date fill (British)",H,"Date field on a form","Right-click the date field","Fills today as DD/MM/YYYY; toast 'Date set to 20/06/2026'"),
 ("Right-click","Time fill (24h)",H,"Time field","Right-click the time field","Fills now as HH:MM (24h); toast 'Time set to 14:30'"),
 ("Right-click","Status cycle",M,"Status combobox","Right-click repeatedly","Cycles Awaiting Start→In Progress→Completed…; toast each step"),
 ("Right-click","Completed/Sealed By",H,"User lookup labelled Completed By/Sealed By","Right-click the field","Opens lookup, selects current user; toast 'Set to <you>'"),
 ("Right-click","Conducted By / Assigned Staff",M,"Those user lookups","Right-click","Same self-fill behaviour"),
 ("Right-click","Exhibit Type marker",H,"Exhibit Name contains a marker (SIM/MEM/SD/USB/HDD)","Right-click Exhibit Type picklist","Auto-selects SIM Card / Memory Card / USB Drive / Hard Drive accordingly; toast"),
 ("Right-click","Exhibit Type no marker",M,"Exhibit Name has no marker","Right-click Exhibit Type","Does nothing intrusive; a second right-click gives native menu"),
 ("Right-click","Forensic Case lookup",M,"Forensic Case lookup field","Right-click","Opens lookup, picks latest real case; toast 'Forensic case set to …' (no glued date)"),
 ("Right-click","Zoom 100% reliability",H,"Browser at 100%","Right-click date & exhibit-type fields a few times","Works first time every time (re: the zoom root-cause)"),
 ("Right-click","Selectivity",M,"A non-target field","Right-click a plain text field","No quick-fill fires; native menu as normal"),
 # ── Generated Material right-click ──
 ("Generated Material","Exhibit Type from MG22 name",H,"New/Edit Generated Material whose Name contains MG22a or MG22B","Right-click the Exhibit Type picklist","Auto-selects 'MG22a SFR' / 'MG22B SFR' to match the name (case-insensitive); toast. Option labels are adjustable in content/datetime.js if your org words them differently"),
 ("Generated Material","Status QA cycle",M,"Generated Material Status field","Right-click the Status field repeatedly","Steps Awaiting QA → QA Complete → Complete Awaiting Return → Returned, one per right-click, toast each step. The Exhibit/Process cycle (Awaiting Start→In Progress→Completed) is unaffected"),
 ("Generated Material","Encryption Password from Case Background",H,"Generated Material with an Encryption Password field; the parent case's Case Background holds a password (e.g. 'Password: xxxx', 'Password-xxxx' or 'Password xxxx')","Right-click the Encryption Password field","Fills the password parsed from the case background; toast 'Encryption password set from case background'. 'No password found…' if there is none"),
 ("Generated Material","Password — New from a case",M,"Create a Generated Material via a case's related-list 'New' (URL carries the case in backgroundContext)","Right-click Encryption Password","Resolves the parent case from the URL-encoded backgroundContext and fills the password — works even though the case page isn't directly visible / on another tab"),
 ("Generated Material","Password — selectivity",L,"Case Background prose merely mentions the word 'password', not a labelled value","Right-click Encryption Password","Does NOT grab a stray word — the parser is line-anchored to a 'Password:' / 'Password ' line; leaves the field for manual entry"),
 # ── Template menu + insertion + variables + undo ──
 ("Templates","Button opens menu",H,"Notes/Forensic Strategy field","Click 📄 (single click, even unfocused)","Menu opens first click; title shows count"),
 ("Templates","Alt+T",M,"Active editor","Press Alt+T","Template menu opens on the first visible editor"),
 ("Templates","Search + categories",M,"4+ templates / 2+ categories","Type in search; pick a category","Filters live; matches highlighted; category filter works"),
 ("Templates","Recents + pins + badges",L,"Some recents/pins/official","Open menu","Recently used section; ★ pinned first; Official/Built-in badges; hover preview"),
 ("Templates","Variable substitution",H,"Template with all variables","Insert into Notes","{{date}}/{{time}}/{{dateTime}} British; {{examiner}}/{{caseRef}}/{{teamName}} resolved or [placeholder]"),
 ("Templates","Undo (Alt+Z / toast)",H,"Just inserted a template","Press Alt+Z or click Undo","Insertion removed; toast 'Undid \"name\" (just now)'"),
 ("Templates","Forensic Strategy priority",L,"On a Forensic Strategy field","Open menu","Forensic Strategy template floated to top"),
 # ── Rich-text fidelity into Salesforce ──
 ("Rich-text insert","Multi-block faithful",H,"Rich template (paras, list, colour, bold) saved","Insert into Forensic Strategy","ALL content appears (not just first line); formatting preserved within Quill's limits"),
 ("Rich-text insert","Indented bullets",H,"Template with indented bullets","Insert","Bullets survive; nothing after them is dropped (div→p + list repair)"),
 ("Rich-text insert","Colour & size",M,"Template with coloured/sized text","Insert","Colour and size carried through; default text renders black"),
 ("Rich-text insert","Plain template",M,"Plain-text template","Insert","Inserts as plain text, unchanged behaviour"),
 ("Rich-text insert","Tables stripped gracefully",L,"Content that had a table pasted","Insert","No table (Quill limit) but surrounding text intact; no corruption"),
 # ── Notes formatting ──
 ("Notes format","List-view expansion",L,"List view with a Notes column","View the column","Concatenated notes expanded into readable blocks; words un-glued; pinned-light styling readable"),
 # ── Record navigation ──
 ("Navigation","Alt+←/→",M,"Exhibit Process record from a list","Press Alt+← / Alt+→","Moves to prev/next record in list order"),
 ("Navigation","Counter + bounds",L,"Navigating","Observe counter; reach list ends","Counter '3 / 12' fades ~3s; buttons disable at start/end"),
 ("Navigation","Large list loads fully",H,"Case with >21 processes","Open it; click the first process","Count shows the FULL total (e.g. 1/42), not 1/21; list briefly dims then settles at the top; stepping covers all"),
 ("Navigation","Revisit uses cache",L,"A case opened before (count unchanged)","Re-open the same case; click a process","Instant, no dim (served from cache); count still correct. Add a process then revisit → it reloads"),
 # ── Case project / alias ──
 ("Case alias","Shown where SF doesn't",M,"A forensic case that has a Project/alias","Open a Task related to it; open the Recently Viewed cases list","The project alias appears next to the case (e.g. 'CY-26-0542 · Tioga'); cases with no alias show nothing"),
 ("Case alias","Tasks split-view team lists",H,"A Tasks list filtered by team (e.g. Examiner Team Leicester / Manchester) with CY cases that have an alias","Open the list and look at the Related To column","EVERY CY case shows its alias next to the number IMMEDIATELY (e.g. 'CY-26-0734 · Albarola'), with no clicking in/out and no refresh; LP/DC/DP cases with no alias stay blank. (These are legacy-Aura data-recordid links rendered in zero-width force-lookup cells — the alias must still be matched AND visible)"),
 ("Case alias","Not duplicated",L,"A list that already has a Project column (Examiner Team / All)","Open it","No extra alias added — the existing Project column is left alone"),
 ("Case alias","Live toggle",L,"Aliases showing on a page","Turn 'Show Case Project / Alias' off, then on — WITHOUT refreshing","Off = aliases vanish immediately; On = they reappear immediately. No page refresh needed. (If the org has no Project field, the feature is silently inert)"),
 # ── Photo download ──
 ("Photo download","Download All",M,"Uploaded Documents section with photos","Click 'Download All' → Start","Files download; progress toasts; success count; button resets"),
 ("Photo download","No photos / errors",L,"Section with no photos","Click Download All","Clear warning 'No photographs found'; no crash"),
 # ── Case report ──
 ("Case report","Export from page",H,"Forensic Case record","Click 'Export Case Report' in the action bar","Sanitised HTML report downloads; success toast"),
 ("Case report","Export from popup",M,"On a case page","Popup → 'Export Current Case'","Popup closes; report generates on the page"),
 ("Case report","Button gating",M,"Not a case page","Check popup/page","Button disabled with hint to open a Forensic Case"),
 ("Case report","Sanitisation",H,"Report generated","Open the HTML; check content","Commercially-sensitive content stripped; case data correct; Save-as-PDF view works"),
 # ── Manager views / list ──
 ("Manager","Views present",M,"Admin, manager open","Click Templates / Reviews / Usage / About","Each view loads; correct subtitle; 'At a glance' tiles (Active/Due ≤30/Overdue/Teams)"),
 ("Manager","Teams tile count",L,"Templates spanning several teams (DF, eDiscovery, Quality…)","Templates view → read the 'Teams' tile and hover it","Counts the DISTINCT teams the templates cover (multi-team aware) — not '1'; the tooltip explains it counts distinct assigned teams (Global isn't a team)"),
 ("Manager","List columns & badges",M,"Templates view","Inspect the table","Headers Doc ID/Name/Version/Status/Category/Scope/Review Due/Actions; status & scope badges correct; own team highlighted"),
 ("Manager","Search & sort",M,"Several templates","Use filter; click sortable headers","Filters by name/category/team; sort indicators work"),
 ("Manager","Review Due formatting",M,"Templates with review dates","Inspect Review Due","British DD/MM/YYYY; overdue red, ≤30d amber, with tooltips"),
 ("Manager","Bulk ops",M,"Admin; rows selected","Use bulk bar (set status / move team / delete)","Applies sequentially with progress; failures reported; no version snapshot for metadata-only"),
 # ── Manager edit / version ──
 ("Manager edit","Create template",H,"Admin","New Template → fill → Save to Salesforce","Saved; appears in list; effective/review dates British; v1.0"),
 ("Manager edit","Edit content → version bump",H,"Existing template","Change CONTENT, pick minor/major, give reason, save","Version bumps; reason required; new history snapshot"),
 ("Manager edit","Metadata-only edit",M,"Existing template","Change only status/team/date, save","No version bump; no reason required; no new snapshot"),
 ("Manager edit","Rename → version bump",M,"Existing template","Change ONLY the Name; pick minor/major; give a reason; save","Treated like a content change — version bumps, reason required, a new history snapshot is created. Status/team/date-only edits still don’t bump."),
 ("Manager edit","Clone as draft",M,"Existing template","Clone","Opens new editor, status Draft, name '(Copy)', reason prefilled"),
 ("Manager edit","Delete with history",M,"Template with versions","Delete → confirm","Child versions removed first, then template; clear messaging"),
 ("Manager edit","Delete hidden without permission",M,"Admin whose Salesforce DELETE permission has been removed (e.g. at go-live)","Open Manager templates list + bulk bar","No Delete buttons appear (row or bulk) — gated on the real Salesforce permission, not just the IsAdmin flag; reload + sync after the permission change"),
 ("Manager edit","Status lifecycle",M,"Editing","Set Draft/Active/Under Review/Superseded/Retired","Only Active reaches analysts; others hidden from insert menus"),
 # ── Manager rich-text editor ──
 ("RTE editor","Default font/size",M,"New template editor","Click into body","Default presents as Salesforce Sans 13 (system fallback locally); font box shows 'Salesforce Sans'"),
 ("RTE editor","Bold/italic/underline/strike",M,"Editor","Apply each","Formatting applied; buttons show active state on selection"),
 ("RTE editor","Lists + highlight",M,"Editor","Make bullet & numbered lists","Lists apply; the list button highlights when cursor inside that list"),
 ("RTE editor","Alignment + indent",L,"Editor","Left/centre/right/justify + indent/outdent","Applied; alignment buttons reflect state"),
 ("RTE editor","Font / size (px)",M,"Editor","Pick a font and a px size (e.g. 16)","Applied to selection; boxes reflect cursor; blank when selection is mixed"),
 ("RTE editor","Colour swatch",M,"Editor","Pick a colour; click default text","Swatch shows chosen colour; for default text shows BLACK (the effective colour), not dark-mode white"),
 ("RTE editor","Link",L,"Editor","Insert a link","Wraps selection / inserts URL; opens safely"),
 ("RTE editor","Image file-picker auto-fit",M,"Editor","Insert image → pick a file (e.g. logo)","File explorer opens; image auto-shrunk to fit; embeds; or clear 'too large' message"),
 ("RTE editor","Paste from Word",H,"Word/Salesforce content on clipboard","Paste into the body","Formatting kept (bold/lists/colour); tables/scripts stripped; bullets work"),
 ("RTE editor","Live selection readout",M,"Mixed-format content","Click around / select across formats","Toolbar reflects cursor; boxes blank on mixed selection (Word-like)"),
 ("RTE editor","Character counter + guard",H,"Editor","Type/paste a lot; watch counter; try to exceed","Counter 'used / 32,768'; turns red over limit; save blocked with a clear message (not a raw SF error)"),
 ("RTE editor","Dark-mode paste visible",H,"Dark theme; paste black text from Salesforce","Paste into editor","Text is readable (white) in the dark editor; inserts black in Salesforce"),
 # ── Multi-team picker ──
 ("Teams","Single-team fallback",H,"No Teams__c field","Edit a template","Single Team dropdown (Global + teams); behaves as before"),
 ("Teams","Multi-team picker",H,"Teams__c field exists","Edit a template","Checkbox list of teams; tick several (e.g. DF + Cyber); none = Global"),
 ("Teams","Multi-team visibility",H,"Template set to DF+Cyber","Log in as DF member, then eDiscovery member","DF sees it; eDiscovery does NOT; Global member sees Global only"),
 ("Teams","Badges show teams",M,"Multi-team template","View list","Scope badge shows the team codes; own team highlighted"),
 # ── Version history ──
 ("History","View history + diff",M,"Template with versions","Open History; compare two versions","Snapshots listed (British timestamps); diff shows added/removed; readable (text, not HTML markup)"),
 ("History","Export CSV",L,"History open","Export CSV","CSV downloads with versions/reasons/dates"),
 # ── Usage dashboard ──
 ("Usage","Local log",M,"Inserted templates on this device","Manager → Usage","Entries newest-first; columns When/Template/Record/User; British date+time"),
 ("Usage","Record link capture",M,"Insert in a record page vs a list pop-up","Compare entries","Record page inserts carry a record link; list pop-up inserts don't (as documented)"),
 ("Usage","Filters + sort",L,"Several entries","Use search + template/user filters + sortable headers","Filter and sort work; British formats preserved"),
 ("Usage","Org-wide (if object exists)",L,"Usage object deployed","Admin → Usage","Switches to org-wide; warning banner if writes rejected (object 'In Development')"),
 ("Usage","Org-wide records EVERY user",H,"Usage object deployed; standard-user perm set has Create + FLS-Edit on the fields; admin perm set has 'View All'","A STANDARD (non-admin) user inserts a template, then an admin opens Manager → Usage","The standard user's insertion appears in the admin's org-wide log — not just admins' own activity (the previous admin-only write gate was removed). If Salesforce rejects the write the admin sees the banner; logging resumes automatically once perms/Deployment Status are fixed (no rebuild)"),
 # ── Read-only mode ──
 ("Read-only","Non-admin viewer",H,"Ordinary member login","Open Manager","Read-only: no New/Edit/Delete, no Reviews tab; View + History only; correct subtitle"),
 ("Read-only","Scope correctness",H,"Member of team DF","Browse templates","Sees DF active templates + Global only; nothing from other teams"),
 # ── Dark mode specifics ──
 ("Dark mode","Parity sweep",M,"Dark theme","Open popup + manager + a record page","All surfaces legible; no white-on-white or black-on-black; focus rings visible"),
 # ── Background ──
 ("Background","20-min sync + manual",L,"Connected, SF tab open","Wait for auto-sync / force via Diagnostics","Templates refresh on schedule and on demand"),
 ("Background","Review notification",L,"Admin; overdue templates","Trigger a sync","At most one notification/day; click opens manager"),
 # ── Diagnostics feature ──
 ("Diagnostics","Capture + download",M,"Popup open","Popup → Diagnostics → turn ON Capture; do a few actions (insert, right-click); Download log; open the .txt","Toggle persists; events captured; file downloads and opens as clean UTF-8 (no mojibake); shows actions WITH outcomes (e.g. 'date set')"),
 ("Diagnostics","Off by default + clear",L,"Fresh install","Check the toggle; use Clear","Off by default — nothing recorded until enabled; Clear empties the buffer; turning on starts fresh. Safety: buffer capped at 2,000 events; if left on it auto-disables after 24h"),
 # ── Security / gating ──
 ("Security","Admin gating",H,"Non-admin","Attempt admin actions","Cannot create/edit/delete; listAll returns PERMISSION_DENIED → read-only viewer"),
 ("Security","Acts as the user",H,"Any user","Inspect access","Extension only sees/does what the SF user can; no elevated access"),
 ("Security","No secrets shipped",M,"Build","Inspect package","No OAuth secrets in the extension; config.js gitignored"),
 ("Security","OAuth flow (PKCE + state)",M,"Connecting","Disconnect, then Connect Salesforce","Sign-in completes normally; the flow uses PKCE and a CSRF 'state' the extension verifies. A tampered/mismatched callback aborts with STATE_MISMATCH in the service-worker console"),
 ("Security","Multi-team membership",M,"User with 2+ NucleusTeamMember__c records (different teams)","Connect; open the template menu + manager About","Identity shows 'Team A · Team B'; menu/manager list templates targeted at EITHER team plus Global — and NOTHING from teams the user is not in. Admin if IsAdmin__c is set on any membership"),
 ("Security","Single-team unchanged",L,"User in exactly one team","Connect; open the template menu","Behaves exactly as before — their team's templates + Global; identity shows the one team"),
 # ── Read-acknowledgements (QMS) ──
 ("Acknowledgements","Mark a controlled doc",M,"Admin; a template","Tick 'Requires acknowledgement' on it; Save","It becomes a controlled document — an Acknowledge chip appears for members of its team(s)"),
 ("Acknowledgements","Analyst acknowledges",M,"Template ticked RequiresAck; member of its team","Open it in the manager → click 'I have read & understood vX'","Chip flips to '✓ Acknowledged'; banner count drops; a NucleusTemplateAck__c record is created (CreatedBy = you)"),
 ("Acknowledgements","Re-ack on new version",M,"Already acknowledged a controlled template","Admin publishes a new version; re-sync","Shows outstanding again — the old acknowledgement no longer matches the current version"),
 ("Acknowledgements","Admin matrix",M,"Admin; some acknowledgements recorded","Manager → Acknowledgements tab","Per controlled template: acked/total + %, status, and the OUTSTANDING members' names — scoped to the template's assigned team(s)"),
 ("Acknowledgements","Outstanding nudge",L,"Outstanding controlled templates for you","Trigger a background sync (SF tab open)","At most one browser notification per day; clicking it opens the manager"),
 ("Acknowledgements","Not-yet-enabled message",L,"Ack object not deployed / In Development, or the user lacks Create on it","Click 'I have read & understood vX'","Friendly, actionable message that acknowledgements aren't switched on yet (a template admin must finish setup) — NOT a raw 'entity type cannot be inserted' error"),
 # ── Suggest-an-edit (change-requests) ──
 ("Suggestions","Member suggests an edit",M,"Member (read-only viewer)","Click 'Suggest edit' on a template; change the text + add a reason; Send","Confirmation shown; a NucleusTemplateChangeRequest__c (Pending) is created by you. Template itself is unchanged"),
 ("Suggestions","Admin sees pending",M,"Admin; a suggestion exists","Open the manager","'Suggestions' tab appears with a count badge; the suggestion is listed with submitter + reason"),
 ("Suggestions","Diff",L,"Admin; Suggestions tab","Click 'View diff'","Side-by-side added/removed lines: suggested vs current version"),
 ("Suggestions","Apply",M,"Admin; a suggestion","Click 'Apply…'","Request marked Approved; editor opens prefilled with the proposed content + a change reason; Saving publishes a normal new version"),
 ("Suggestions","Reject",L,"Admin; a suggestion","Click 'Reject' and confirm","Request marked Rejected; it leaves the pending list; template unchanged"),
 ("Suggestions","Admin nudge",L,"Pending suggestions exist","Trigger a background sync","At most one browser notification per day to admins; clicking opens the manager"),
 # ── Visual / UX sweep ──
 ("UX","Layout & overflow",M,"All surfaces","Resize popup/manager; long names","No clipping/overflow; tooltips for truncation; narrow-width holds"),
 ("UX","British spelling",L,"UI text","Scan labels (e.g. 'centre')","British spellings; consistent terminology"),
 ("UX","Copy accuracy",M,"All toasts/labels","Cross-check against actions","Wording matches behaviour; no stale strings"),
 ("UX","Empty states",L,"No data conditions","View empty list/usage/reviews","Helpful empty-state messages, not blank panels"),
 ("UX","Toast clears Save/Cancel",M,"Trigger a toast inside a modal with a Save/Cancel bar (e.g. right-click a date in 'New Process')","Watch where the toast appears","Toast sits near the bottom but ABOVE the Save/Cancel buttons — never covering them, whether a floating modal footer or the inline docked footer"),
]

# ─────────────────────────────────────────────────────────────────────────────
def esc(s):
    return html.escape(str(s), quote=True)

def cell(text, style="ce_norm", value_type="string", colspan=1, formula=None, number=None):
    attrs = f' table:style-name="{style}"'
    if colspan > 1:
        attrs += f' table:number-columns-spanned="{colspan}"'
    if style == "ce_result":
        attrs += ' table:content-validation-name="resultval"'
    if formula is not None:
        attrs += f' table:formula="{esc(formula)}" office:value-type="float" office:value="{number or 0}"'
        body = f'<text:p>{esc(number or 0)}</text:p>'
    else:
        attrs += f' office:value-type="{value_type}"'
        lines = text if isinstance(text, list) else [text]
        body = "".join(f"<text:p>{esc(l)}</text:p>" for l in lines)
    out = f'<table:table-cell{attrs}>{body}</table:table-cell>'
    if colspan > 1:
        out += '<table:covered-table-cell table:number-columns-repeated="%d"/>' % (colspan - 1)
    return out

def row(cells):
    return "<table:table-row>" + "".join(cells) + "</table:table-row>"

# ── Styles ──
STYLES = """
 <style:style style:name="co_id" style:family="table-column"><style:table-column-properties style:column-width="1.4cm"/></style:style>
 <style:style style:name="co_area" style:family="table-column"><style:table-column-properties style:column-width="2.6cm"/></style:style>
 <style:style style:name="co_feat" style:family="table-column"><style:table-column-properties style:column-width="3.4cm"/></style:style>
 <style:style style:name="co_pri" style:family="table-column"><style:table-column-properties style:column-width="1.6cm"/></style:style>
 <style:style style:name="co_pre" style:family="table-column"><style:table-column-properties style:column-width="4.5cm"/></style:style>
 <style:style style:name="co_steps" style:family="table-column"><style:table-column-properties style:column-width="6.5cm"/></style:style>
 <style:style style:name="co_exp" style:family="table-column"><style:table-column-properties style:column-width="6.5cm"/></style:style>
 <style:style style:name="co_res" style:family="table-column"><style:table-column-properties style:column-width="2.2cm"/></style:style>
 <style:style style:name="co_act" style:family="table-column"><style:table-column-properties style:column-width="5cm"/></style:style>
 <style:style style:name="co_tester" style:family="table-column"><style:table-column-properties style:column-width="2.2cm"/></style:style>
 <style:style style:name="co_date" style:family="table-column"><style:table-column-properties style:column-width="2.4cm"/></style:style>
 <style:style style:name="co_wide" style:family="table-column"><style:table-column-properties style:column-width="16cm"/></style:style>
 <style:style style:name="ce_norm" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #b8c2cc" style:vertical-align="top" fo:wrap-option="wrap" fo:padding="0.08cm"/><style:text-properties fo:font-size="9pt"/></style:style>
 <style:style style:name="ce_head" style:family="table-cell"><style:table-cell-properties fo:background-color="#1f5fa8" fo:border="0.5pt solid #b8c2cc" style:vertical-align="middle" fo:padding="0.1cm"/><style:text-properties fo:font-weight="bold" fo:color="#ffffff" fo:font-size="9.5pt"/></style:style>
 <style:style style:name="ce_title" style:family="table-cell"><style:table-cell-properties fo:background-color="#0b2a4a" fo:padding="0.15cm"/><style:text-properties fo:font-weight="bold" fo:color="#ffffff" fo:font-size="13pt"/></style:style>
 <style:style style:name="ce_section" style:family="table-cell"><style:table-cell-properties fo:background-color="#dce7f3" fo:border="0.5pt solid #b8c2cc" fo:padding="0.08cm"/><style:text-properties fo:font-weight="bold" fo:color="#0b2a4a" fo:font-size="9.5pt"/></style:style>
 <style:style style:name="ce_result" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #b8c2cc" style:vertical-align="middle" fo:padding="0.08cm"/><style:text-properties fo:font-size="9pt"/></style:style>
 <style:style style:name="ce_h1" style:family="table-cell"><style:text-properties fo:font-weight="bold" fo:color="#0b2a4a" fo:font-size="14pt"/></style:style>
 <style:style style:name="ce_h2" style:family="table-cell"><style:text-properties fo:font-weight="bold" fo:color="#1f5fa8" fo:font-size="11pt"/></style:style>
 <style:style style:name="ce_lbl" style:family="table-cell"><style:table-cell-properties fo:background-color="#e8eef6" fo:border="0.5pt solid #b8c2cc" fo:padding="0.08cm"/><style:text-properties fo:font-weight="bold" fo:font-size="9.5pt"/></style:style>
 <style:style style:name="ce_pass" style:family="table-cell"><style:table-cell-properties fo:background-color="#c6efce" fo:border="0.5pt solid #b8c2cc" fo:padding="0.08cm"/><style:text-properties fo:color="#1b6b33" fo:font-weight="bold" fo:font-size="9pt"/></style:style>
 <style:style style:name="ce_fail" style:family="table-cell"><style:table-cell-properties fo:background-color="#ffc7ce" fo:border="0.5pt solid #b8c2cc" fo:padding="0.08cm"/><style:text-properties fo:color="#9c1414" fo:font-weight="bold" fo:font-size="9pt"/></style:style>
 <style:style style:name="ce_part" style:family="table-cell"><style:table-cell-properties fo:background-color="#ffeb9c" fo:border="0.5pt solid #b8c2cc" fo:padding="0.08cm"/><style:text-properties fo:color="#7a5c00" fo:font-weight="bold" fo:font-size="9pt"/></style:style>
 <style:style style:name="ce_na" style:family="table-cell"><style:table-cell-properties fo:background-color="#e2e6ea" fo:border="0.5pt solid #b8c2cc" fo:padding="0.08cm"/><style:text-properties fo:color="#555" fo:font-size="9pt"/></style:style>
 <style:style style:name="cf_pass" style:family="table-cell"><style:table-cell-properties fo:background-color="#c6efce"/></style:style>
 <style:style style:name="cf_fail" style:family="table-cell"><style:table-cell-properties fo:background-color="#ffc7ce"/></style:style>
 <style:style style:name="cf_part" style:family="table-cell"><style:table-cell-properties fo:background-color="#ffeb9c"/></style:style>
 <style:style style:name="cf_na" style:family="table-cell"><style:table-cell-properties fo:background-color="#e2e6ea"/></style:style>
"""

# Conditional formatting so the Result column auto-colours as testers fill it in.
CF = (
 '<calcext:conditional-formats>'
 '<calcext:conditional-format calcext:target-range-address="\'Test Cases\'.H3:H400">'
 '<calcext:condition calcext:apply-style-name="cf_pass" calcext:value="cell-content()=&quot;Pass&quot;" calcext:base-cell-address="\'Test Cases\'.H3"/>'
 '<calcext:condition calcext:apply-style-name="cf_fail" calcext:value="cell-content()=&quot;Fail&quot;" calcext:base-cell-address="\'Test Cases\'.H3"/>'
 '<calcext:condition calcext:apply-style-name="cf_part" calcext:value="cell-content()=&quot;Partial&quot;" calcext:base-cell-address="\'Test Cases\'.H3"/>'
 '<calcext:condition calcext:apply-style-name="cf_na" calcext:value="cell-content()=&quot;N/A&quot;" calcext:base-cell-address="\'Test Cases\'.H3"/>'
 '</calcext:conditional-format>'
 '</calcext:conditional-formats>'
)

VALIDATION = (
 '<table:content-validations>'
 '<table:content-validation table:name="resultval" '
 'table:condition="of:cell-content-is-in-list(&quot;Pass&quot;;&quot;Fail&quot;;&quot;Partial&quot;;&quot;N/A&quot;;&quot;Not run&quot;)" '
 'table:allow-empty-cell="true" table:display-list="unsorted">'
 '<table:help-message table:title="Result"><text:p>Choose Pass / Fail / Partial / N/A / Not run</text:p></table:help-message>'
 '</table:content-validation>'
 '</table:content-validations>'
)

HEADERS = ["ID","Area","Feature","Priority","Pre-conditions","Steps","Expected result","Result","Actual / notes","Tester","Date"]
COLS = ["co_id","co_area","co_feat","co_pri","co_pre","co_steps","co_exp","co_res","co_act","co_tester","co_date"]

# ── Sheet: Test Cases ──
def sheet_cases():
    rows = []
    rows.append(row([cell("CYFOR Nucleus Enhancer — Validation Results (v1.0.0)", "ce_title", colspan=11)]))
    rows.append(row([cell(h, "ce_head") for h in HEADERS]))
    area = None
    counters = {}
    for (a, feat, pri, pre, steps, exp) in CASES:
        if a != area:
            area = a
            rows.append(row([cell(a, "ce_section", colspan=11)]))
        code = "".join(w[0] for w in a.replace("/"," ").split())[:4].upper()
        counters[code] = counters.get(code, 0) + 1
        cid = f"{code}-{counters[code]:02d}"
        rows.append(row([
            cell(cid), cell(a), cell(feat), cell(pri), cell(pre),
            cell(steps if isinstance(steps, list) else [steps]),
            cell(exp), cell("", "ce_result"), cell(""), cell(""), cell(""),
        ]))
    cols = "".join(f'<table:table-column table:style-name="{c}"/>' for c in COLS)
    total = sum(1 for c in CASES)
    return (f'<table:table table:name="Test Cases">{cols}'
            + "".join(rows) + CF + '</table:table>'), total

# ── Sheet: Instructions & Environment ──
def sheet_instructions(total):
    R = []
    R.append(row([cell("How to use this workbook", "ce_h1", colspan=2)]))
    R.append(row([cell(["Work through the 'Test Cases' sheet top to bottom. For each row set the Result cell "
                        "(dropdown: Pass / Fail / Partial / N/A / Not run), and record what you saw in 'Actual / notes', "
                        "plus your initials and the date.", f"There are {total} cases across all feature areas.",
                        "This is an internal self-check, not a formal/Quality validation. Use the Diagnostics sheet "
                        "(or docs/Nucleus_Enhancer_Diagnostics.md) to capture detail when something misbehaves."], "ce_norm", colspan=2)]))
    R.append(row([cell("Result colour key", "ce_h2", colspan=2)]))
    for label, st in [("Pass","ce_pass"),("Fail","ce_fail"),("Partial","ce_part"),("N/A","ce_na"),("Not run","ce_norm")]:
        R.append(row([cell(label, st), cell({"Pass":"Works as expected","Fail":"Does not meet the expected result",
            "Partial":"Mostly works; note the caveat","N/A":"Not applicable in this environment",
            "Not run":"Not yet tested"}[label])]))
    R.append(row([cell("Environment (record actuals)", "ce_h2", colspan=2)]))
    for k, v in [("Browser + version","Chrome ____ / Edge ____  (zoom 100%)"),("OS","Windows ____"),
                 ("Salesforce org / sandbox","____"),("Account & role","____ (admin / member / no-team)"),
                 ("Extension version","1.0.0"),("Tester","____"),("Date","____")]:
        R.append(row([cell(k, "ce_lbl"), cell(v)]))
    cols = '<table:table-column table:style-name="co_area"/><table:table-column table:style-name="co_wide"/>'
    return f'<table:table table:name="Instructions">{cols}' + "".join(R) + '</table:table>'

# ── Sheet: Summary ──
def sheet_summary():
    R = []
    R.append(row([cell("Summary", "ce_h1", colspan=2)]))
    R.append(row([cell("Overall (live counts from the Result column)", "ce_h2", colspan=2)]))
    rng = "[$'Test Cases'.H3:H400]"
    for label, st in [("Pass","ce_pass"),("Fail","ce_fail"),("Partial","ce_part"),("N/A","ce_na"),("Not run","ce_norm")]:
        f = f'of:=COUNTIF({rng};"{label}")'
        R.append(row([cell(label, st), cell("", "ce_norm", formula=f)]))
    R.append(row([cell("Total cases", "ce_lbl"), cell("", "ce_norm", formula=f'of:=COUNTA([$\'Test Cases\'.A3:A400])-COUNTIF([$\'Test Cases\'.D3:D400];"")')]))
    R.append(row([cell("Per-area (Pass / Fail)", "ce_h2", colspan=2)]))
    areas = []
    for (a, *_ ) in CASES:
        if a not in areas: areas.append(a)
    arng = "[$'Test Cases'.B3:B400]"
    for a in areas:
        fp = f'of:=COUNTIFS({arng};"{a}";{rng};"Pass")'
        ff = f'of:=COUNTIFS({arng};"{a}";{rng};"Fail")'
        R.append(row([cell(a, "ce_lbl"),
                      cell([], "ce_norm", formula=fp)]))  # Pass count; Fail omitted for layout simplicity
    cols = '<table:table-column table:style-name="co_feat"/><table:table-column table:style-name="co_pri"/>'
    return f'<table:table table:name="Summary">{cols}' + "".join(R) + '</table:table>'

# ── Sheet: Diagnostics (condensed) ──
def sheet_diag():
    R = []
    R.append(row([cell("Diagnostics quick reference", "ce_h1", colspan=2)]))
    items = [
        ("Capture a diagnostic log (easy)","Popup → Diagnostics → switch ON 'Capture diagnostic log'. Refresh the Salesforce tab, reproduce the issue / run the tests, then Popup → 'Download log' to save a .txt to send to support. (The spreadsheet is your Pass/Fail record; this log is just technical detail for diagnosing failures.)"),
        ("Manual toggle (advanced)","Service-worker console: chrome.storage.local.set({ cyforDebug: true }); then refresh the Salesforce tab. Disable with false."),
        ("Open the service-worker console","chrome://extensions → CYFOR Nucleus Enhancer → 'Inspect views: service worker'."),
        ("Content-script logs","Appear in the PAGE console (F12 on the Salesforce tab). Filter with [Cyfor."),
        ("Inspect stored state","chrome.storage.local.get(null, console.log)  ·  sfOAuthUser  ·  sfRemoteTemplates / sfTemplatesSyncedAt  ·  usageLogError"),
        ("Force a sync","chrome.runtime.sendMessage({action:'sfTemplates.sync', forceRefresh:true}, console.log)"),
        ("Check multi-team / limits","chrome.runtime.sendMessage({action:'sfTemplates.listAll'}, r=>console.log(r.fields)) → fields.teamsMulti, fields.contentMaxLength"),
        ("Insertion path","[Cyfor:insert] method = paste (good) vs insertHTML/innerHTML (fallback) — if rich content is lost, capture this."),
        ("Right-click native menu","Set browser zoom to 100% (zoom shifts elementFromPoint)."),
        ("Full cheat-sheet","docs/Nucleus_Enhancer_Diagnostics.md"),
    ]
    for k, v in items:
        R.append(row([cell(k, "ce_lbl"), cell(v)]))
    cols = '<table:table-column table:style-name="co_feat"/><table:table-column table:style-name="co_wide"/>'
    return f'<table:table table:name="Diagnostics">{cols}' + "".join(R) + '</table:table>'

# ── Assemble ──
cases_xml, total = sheet_cases()
doc = (
 '<?xml version="1.0" encoding="UTF-8"?>\n'
 '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
 ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
 ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
 ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
 ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"'
 ' xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"'
 ' office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">'
 '<office:automatic-styles>' + STYLES + '</office:automatic-styles>'
 '<office:body><office:spreadsheet>'
 + VALIDATION
 + sheet_instructions(total)
 + cases_xml
 + sheet_summary()
 + sheet_diag()
 + '</office:spreadsheet></office:body></office:document>'
)

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(doc)
print(f"Wrote {OUT} — {total} test cases.")
