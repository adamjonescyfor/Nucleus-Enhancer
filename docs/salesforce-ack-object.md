# Salesforce setup — Read-acknowledgement (controlled-document sign-off)

Lets each analyst record **"I have read and understood v2.1"** for a *controlled* template, and lets admins see who is outstanding. This is the QMS / UKAS piece. The extension discovers everything below automatically — field API names are describe-discovered, so the exact names don't have to match.

## 1. New object: `NucleusTemplateAck__c`
Label **Template Acknowledgement**. Record Name: **Auto Number** (records are created by the extension, never typed).

| Field | Type | Notes |
|---|---|---|
| `Template__c` | **Lookup → `NucleusTemplate__c`** (required) | which template was acknowledged |
| `Version_Label__c` | **Text(20)** (required) | the version string acknowledged, e.g. `2.1` |

The **who** and **when** come from the standard **CreatedBy / CreatedDate** — immutable, so it's a real audit trail. No other fields needed.

## 2. One checkbox on `NucleusTemplate__c`: `RequiresAck__c`
Label **Requires acknowledgement**, type **Checkbox** (default **unchecked**). This is the control that keeps it manageable: **only ticked templates need sign-off**, so you opt-in your genuine controlled documents (SOPs, procedures) rather than every snippet. Add it to the page layout and make it **editable for template admins, readable for everyone**.

> Leave it unchecked on a template and that template needs no sign-off — only the ones you tick are tracked. (Both the object **and** this checkbox are part of the setup.)

## 3. Permissions / FLS
- **Everyone (all analysts):** **Create + Read** on `NucleusTemplateAck__c`, and **editable + readable** FLS on both its fields (the extension sets them when an analyst acknowledges). **No Edit, No Delete** — an acknowledgement must be permanent.
- **Template admins:** must be able to **read ALL** acknowledgement records (not just their own) so the manager's "who's outstanding" matrix works — e.g. grant **View All** on this object in the admin permission set.
- **Template admins (roster) ⚠️:** the matrix's "outstanding" list is the *members of each template's team(s)*, so admins must also be able to **read all `NucleusTeamMember__c` records** — make that object org-wide **Public Read**, or grant the admin permission set **View All** on it. If admins can only see their own membership, the matrix still loads but **under-reports** who's required.
- `RequiresAck__c` on the template: **editable for admins, readable for everyone** (the sync reads it).

## 4. Optional but recommended — email nudge (the "iPassport" behaviour)
The extension nudges analysts *in-app* (a once-a-day browser notification + a banner in the manager) when they have outstanding acknowledgements. If you also want an **email** when a controlled template changes — like iPassport — add a **record-triggered Flow** on `NucleusTemplate__c`:

- **Trigger:** record updated, **Entry:** `RequiresAck__c = true` **AND** `IsActive__c = true` **AND** the version label field *Is Changed* (a new version published).
- **Action:** Get the active `NucleusTeamMember__c` records for the template's team(s) → email those users: *"[Template] has been updated to v2.1 — please review and acknowledge in Nucleus."*
- For **Global** controlled docs (no team), email all active members.

This stays entirely in Salesforce (the extension can't and shouldn't send email). The in-app acknowledge flow + the admin matrix work with or without it.

## 5. How it behaves once live
- Analysts see an **Acknowledge** chip on controlled templates and a banner with their outstanding count; opening a template gives an **"I have read & understood v2.1"** button.
- A **new version** resets the requirement (the old acknowledgement no longer matches).
- Admins get an **Acknowledgements** tab: per template, how many of the assigned team's members have signed off and **who's outstanding**.
