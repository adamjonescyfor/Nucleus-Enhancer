# Salesforce admin guide — CYFOR Nucleus Enhancer

**For:** the Salesforce administrator. One place for everything the extension needs from Salesforce: the objects, the permissions, and the rollout checklist for ~100 analysts.

## The objects

| Object | Purpose | Status |
|---|---|---|
| `NucleusTemplate__c` | The templates (content, version, status, team, review dates) | ✅ live |
| `NucleusTemplateVersion__c` | One snapshot per content revision — created by the **record-triggered Flow** ([build reference](salesforce-version-history-flow.md)), not the extension | ✅ live |
| `NucleusTeam__c` / `NucleusTeamMember__c` | Teams, membership, per-team **template admin** flag (`IsAdmin__c`) | ✅ live |
| `NucleusTemplateUsage__c` | Org-wide insertion log — which templates are used, by whom, and where ([spec](salesforce-usage-object.md)) | ✅ live |
| `NucleusTemplateAck__c` | Read-acknowledgement ("read & understood") sign-off for controlled templates ([spec](salesforce-ack-object.md)); also needs a `RequiresAck__c` checkbox on `NucleusTemplate__c` | ⬜ optional (QMS) |
| `NucleusReportTemplate__c` | MG22 Word templates (Mitul's feature, currently disabled) | ⬜ when Mitul picks it up |

Field API names never need to match exactly — the extension discovers them from each object's describe.

## Multi-team assignment (optional — one template visible to several teams)

A template can target **one** team (the `Team__c` lookup), **several** teams (the `Teams__c` multi-select picklist below), or be **Global** (both empty). The extension auto-detects `Teams__c` and switches the manager's Team picker to a multi-select; the single `Team__c` lookup keeps working as the migration source and backstop.

**Add** a **Multi-Select Picklist** on `NucleusTemplate__c`:
- **Label:** `Teams` (suggested API name `Teams__c` — any name works; the extension finds any multi-select picklist whose name/label contains "team").
- **Values:** the **team codes**, exactly as in `NucleusTeam__c.TeamCode__c` — one picklist entry per active team. (Codes, **not** display names.)
- **Field-Level Security:** ⚠️ **Readable by everyone who uses templates** — the analyst sync query filters on this field (`Teams__c INCLUDES (…)`), so if it is hidden from them they will see **no** templates. **Editable** for template admins only.
- Add it to the page layout.

**Keep** the existing `Team__c` lookup (don't delete) — it's the migration source and the fallback for un-migrated templates.

**One-time migration:** for every template that has `Team__c` set, copy that team's **code** into `Teams__c`. Global templates (no team) stay empty. *(Clearing `Team__c` afterwards is optional — the extension clears it automatically the next time that template is edited.)*

**Resulting visibility:** a template shows to a user when it is Global (neither team field set) **OR** the legacy lookup targets their team **OR** `Teams__c` includes their team code. Assigning via the multi-select clears the single lookup on the next save, so templates converge to the new field over time.

## Permissions

### Everyone (all ~100 analysts)
- Access to the **connected app** (OAuth login).
- **Read ONLY** on `NucleusTemplate__c`, `NucleusTemplateVersion__c`, `NucleusTeam__c`, `NucleusTeamMember__c` — explicitly **no Create/Edit/Delete**. Templates are controlled documents: every change must go through an admin so versioning, change reasons and the Active-only publishing flow can't be bypassed by editing directly in Salesforce. (Read-only on Team Member also stops users reassigning teams or self-ticking the admin flag.) The extension needs nothing more — all its write paths are admin-gated.
- The one exception: **Create + Read** on `NucleusTemplateUsage__c` (insert-only audit log; no Edit/Delete).
- A **`NucleusTeamMember__c` record** linking them to their team (this is what scopes which templates they see and powers the read-only "View Templates" page). **A user can belong to several teams** — just give them one Team Member record *per* team. They'll then see every template targeted at any of those teams, and count as a template admin if `IsAdmin__c` is ticked on *any one* of them. No extra setup or fields are needed.

### Template admins (per team)
Everything above, plus on the **template-admin permission set**:
| Need | `NucleusTemplate__c` | `NucleusTemplateVersion__c` |
|---|---|---|
| Create/edit templates | Create + Edit | — |
| **Delete a template that has history** (extension removes child snapshots first) | Delete | **Delete** |
| **Manage templates owned by anyone** (incl. leavers) | **Modify All** | **Modify All** |
| Org-wide Usage view | — | "View All" on `NucleusTemplateUsage__c` |

…and `IsAdmin__c = true` on their `NucleusTeamMember__c` record (this is what unlocks the manager's editing UI).

> The most common gotcha: **Delete on the Version object is required to delete *any* edited template — even your own**, because the version lookup restricts the parent delete.

## Readable record names (recommended, ~10 mins)

Two objects use Auto Number names, so list views show meaningless `NTV-0042` / `NTM-0017` instead of what the record is about. The extension never reads either `Name` field (verified), so both changes are safe; existing records keep their old names.

1. **`NucleusTemplateVersion__c`** — Object Manager → change `Name` from Auto Number to **Text**, then in the archiving Flow's Create Records element set Name with
   `LEFT({!$Record.Name}, 70) & " v" & {!$Record__Prior.Version_Label__c}`
   → snapshots are created as e.g. **"Forensic Strategy v2.1"**. (Also in the [Flow doc addendum](salesforce-version-history-flow.md).)
2. **`NucleusTeamMember__c`** — Object Manager → change `Name` from Auto Number to **Text**. These records are created by hand, so whoever creates them just types the user's name as the record Name. Optional zero-effort version: a small **before-save record-triggered Flow** on create/update — Get Records (User where Id = `{!$Record.User__c}`) → assign `{!$Record.Name}` = that user's Name — so the record always names itself after its user.

## Rollout checklist

**Admin-only (the Salesforce admins):**
1. ☐ Connected-app access for all users (profile/permission-set assignment).
2. ☐ Read perms on the four existing Nucleus objects for all users (a "user" permission set or profile update).
3. ☐ Assign the template-admin permission set to each chosen admin (per the table above — esp. Delete/Modify All on `NucleusTemplateVersion__c`).
4. ☐ Create `NucleusTemplateUsage__c` ([spec](salesforce-usage-object.md)) — optional but recommended org-wide insertion log; zero extension work after.
5. ☐ (Optional) Multi-team field — add the `Teams__c` multi-select picklist + read FLS for all + one-time migration ([Multi-team assignment](#multi-team-assignment-optional--one-template-visible-to-several-teams)) if admins should be able to assign a template to several teams.
6. ☐ (Optional, QMS) Read-acknowledgement — create `NucleusTemplateAck__c` + the `RequiresAck__c` checkbox + permissions ([spec](salesforce-ack-object.md)). ⚠️ For the admin "who's outstanding" matrix, also let admins **read all `NucleusTeamMember__c` records** (Public Read OWD, or View All in the admin permission set).
7. ☐ Readable record names (section above) — nice-to-have.
8. ☐ Optional cleanup: delete the unused custom **Changed By / Changed By Email** fields (the extension stopped writing them; standard Created/Last Modified By replaced them).
9. ☐ After everyone is on the current extension version: tell the developer, who can raise the Cloudflare worker's `MIN_CLIENT_VERSION` to retire old builds.

**Data entry (anyone with access, once step 2 is done):**
10. ☐ A `NucleusTeamMember__c` record per user (right team; the user's name as the record Name once step 7 is done). A user who belongs to **several teams** gets one record per team.
11. ☐ Tick `IsAdmin__c` on the chosen admins' Team Member records (remember: admins need BOTH this flag — which unlocks the manager UI — and the permission set from step 3, which is what Salesforce enforces).

## How responsibilities split

- **Salesforce admin:** objects/fields/Flows, permission sets and their assignment, connected-app access. All access control is enforced here — the extension can only do what the signed-in user can do.
- **Record data entry (anyone with access):** Team Member rows (team assignment + admin flags), templates themselves via the Template Manager.
- **Extension (developer):** UI over the same records. Uninstalling it never touches the data.
- **Cloudflare worker (developer):** OAuth only. Salesforce data calls go direct from the extension to Salesforce.
