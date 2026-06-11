# Salesforce admin guide — CYFOR Nucleus Enhancer

**For:** Callum (Salesforce admin). One place for everything the extension needs from Salesforce: the objects, the permissions, and the rollout checklist for ~100 analysts.

## The objects

| Object | Purpose | Status |
|---|---|---|
| `NucleusTemplate__c` | The templates (content, version, status, team, review dates) | ✅ live |
| `NucleusTemplateVersion__c` | One snapshot per content revision — created by the **record-triggered Flow** ([build reference](salesforce-version-history-flow.md)), not the extension | ✅ live |
| `NucleusTeam__c` / `NucleusTeamMember__c` | Teams, membership, per-team **template admin** flag (`IsAdmin__c`) | ✅ live |
| `NucleusTemplateUsage__c` | Org-wide insertion log — extension client ships dormant, lights up when created ([spec](salesforce-usage-object.md)) | ⬜ to create |
| `NucleusReportTemplate__c` | MG22 Word templates (Mitul's feature, currently disabled) | ⬜ when Mitul picks it up |

Field API names never need to match exactly — the extension discovers them from each object's describe.

## Permissions

### Everyone (all ~100 analysts)
- Access to the **connected app** (OAuth login).
- **Read ONLY** on `NucleusTemplate__c`, `NucleusTemplateVersion__c`, `NucleusTeam__c`, `NucleusTeamMember__c` — explicitly **no Create/Edit/Delete**. Templates are controlled documents: every change must go through an admin so versioning, change reasons and the Active-only publishing flow can't be bypassed by editing directly in Salesforce. (Read-only on Team Member also stops users reassigning teams or self-ticking the admin flag.) The extension needs nothing more — all its write paths are admin-gated.
- The one exception: **Create + Read** on `NucleusTemplateUsage__c` once it exists (insert-only audit log; no Edit/Delete).
- A **`NucleusTeamMember__c` record** linking them to their team (this is what scopes which templates they see and powers the read-only "View Templates" page).

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

**Admin-only (Callum / Andy / Law):**
1. ☐ Connected-app access for all users (profile/permission-set assignment).
2. ☐ Read perms on the four existing Nucleus objects for all users (a "user" permission set or profile update).
3. ☐ Assign the template-admin permission set to each chosen admin (per the table above — esp. Delete/Modify All on `NucleusTemplateVersion__c`).
4. ☐ Create `NucleusTemplateUsage__c` ([spec](salesforce-usage-object.md)) — the **only new object**; optional but recommended, zero extension work after.
5. ☐ Readable record names (section above) — nice-to-have.
6. ☐ Optional cleanup: delete the unused custom **Changed By / Changed By Email** fields (the extension stopped writing them; standard Created/Last Modified By replaced them).
7. ☐ After everyone is on the current extension version: tell the developer, who can raise the Cloudflare worker's `MIN_CLIENT_VERSION` to retire old builds.

**Data entry (anyone with access — e.g. Adam, once step 2 is done):**
8. ☐ A `NucleusTeamMember__c` record per user (right team; the user's name as the record Name once step 5.2 is done).
9. ☐ Tick `IsAdmin__c` on the chosen admins' Team Member records (remember: admins need BOTH this flag — which unlocks the manager UI — and the permission set from step 3, which is what Salesforce enforces).

## How responsibilities split

- **Salesforce admin (Callum/Andy/Law):** objects/fields/Flows, permission sets and their assignment, connected-app access. All access control is enforced here — the extension can only do what the signed-in user can do.
- **Record data entry (Adam or anyone with access):** Team Member rows (team assignment + admin flags), templates themselves via the Template Manager.
- **Extension (developer):** UI over the same records. Uninstalling it never touches the data.
- **Cloudflare worker (developer):** OAuth only. Salesforce data calls go direct from the extension to Salesforce.
