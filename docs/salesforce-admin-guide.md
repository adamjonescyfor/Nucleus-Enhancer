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
- **Read** on `NucleusTemplate__c`, `NucleusTemplateVersion__c`, `NucleusTeam__c`, `NucleusTeamMember__c`.
- **Create + Read** on `NucleusTemplateUsage__c` once it exists (no Edit/Delete — audit log).
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

## Rollout checklist

1. ☐ Connected-app access for all users (profile/permission-set assignment).
2. ☐ Read perms on the four Nucleus objects for all users.
3. ☐ `NucleusTeamMember__c` rows for everyone (right team, admin flags for the chosen admins).
4. ☐ Template-admin permission set updated per the table above (esp. Delete/Modify All on `NucleusTemplateVersion__c`).
5. ☐ Create `NucleusTemplateUsage__c` ([spec](salesforce-usage-object.md)) — optional but recommended; zero extension work needed after.
6. ☐ Optional cleanup: delete the unused custom **Changed By / Changed By Email** fields on the template + version objects (the extension stopped writing them; standard Created/Last Modified By replaced them).
7. ☐ After everyone is on the current extension version: tell the developer, who can raise the Cloudflare worker's `MIN_CLIENT_VERSION` to retire old builds.

## How responsibilities split

- **Salesforce (you):** objects, permissions, sharing, the version-history Flow, team membership. All access control is enforced here — the extension can only do what the signed-in user can do.
- **Extension:** UI over the same records (popup insert menus, Template Manager, read-only viewer, version diffs, usage views). Uninstalling it never touches the data.
- **Cloudflare worker (developer):** OAuth only. Salesforce data calls go direct from the extension to Salesforce.
