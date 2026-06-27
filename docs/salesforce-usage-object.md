# Salesforce spec — org-wide template usage log (`NucleusTemplateUsage__c`)

**For:** the Salesforce administrator
**Goal:** one record per template insertion, org-wide — so template admins can see which templates are actually used, by whom, and where (UKAS evidence of template adoption). The extension writes to it automatically — field API names are describe-discovered, so no extension update is needed. (This is the reference spec for the object; it's already created and live.)

## Object

Create custom object **`NucleusTemplateUsage__c`** (label *"Nucleus Template Usage"*), same pattern as the other Nucleus objects, added to the Nucleus Templates app.

> **Deployment Status must be _Deployed_, not _In Development_.** An *In Development* object stays readable to admins but **rejects every record insert** with `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY: entity type cannot be inserted`, so usage silently stops recording while the org-wide view still shows old rows. If you build in a sandbox, re-check the status is *Deployed* after pushing to production.

| Field | Type | Notes |
|---|---|---|
| `Name` | Auto Number, e.g. `USE-{00000}` | |
| **Template Name** → `Template_Name__c` | Text(255) | the inserted template's name |
| **Record Id** → `Record_Id__c` | Text(18) | the Salesforce record the user was on |
| **Record URL** → `Record_URL__c` | URL (or Text 255) | link back to that record |

Who/when come from the standard **Created By / Created Date** — no custom user fields needed. Exact API names don't matter; the extension discovers them from the describe (it looks for *templatename/template*, *recordid*, *recordurl/url*).

## Permissions

- **All extension users:** Create + Read on the object, **plus editable field-level security** on `Template_Name__c`, `Record_Id__c`, `Record_URL__c`. **No Edit, no Delete** (it's an audit log). ⚠️ Object Create *without* FLS-edit on the fields makes the describe report `createable: false` and every insert fails with `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY` — the log silently records nothing for that user. The extension writes a record for **every** connected user, so grant this to all analysts, not just admins.
- Template admins additionally need Read on all records ("View All" on the object) so the manager's org-wide Usage view shows everyone's insertions (with the default Private OWD, an admin without View All only sees rows they created themselves — the "I can only see mine" symptom).

## How it behaves in the extension

- Every insert is logged locally (per device, capped at 500) **and** fire-and-forget mirrored to this object once it exists. Failures are silent by design — a usage write can never break an insert.
- The Template Manager's **Usage** view shows the org-wide log (newest 200, with user names). Admins only.
- The extension checks for the object at most once per service-worker lifetime, so a missing object costs essentially nothing.

## Test plan

1. Create the object + fields, grant Create/Read to a test user.
2. As that user, insert any template into a Notes field.
3. A `USE-…` record appears with Template Name / Record Id / URL, Created By = the user.
4. As a template admin, open Template Manager → Usage → it now shows the org-wide list.
