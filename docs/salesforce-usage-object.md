# Salesforce spec — org-wide template usage log (`NucleusTemplateUsage__c`)

**For:** Callum (Salesforce admin)
**Goal:** one record per template insertion, org-wide — so template admins can see which templates are actually used, by whom, and where (UKAS evidence of template adoption). The extension **already ships the client for this, dormant**: the moment this object exists, usage starts recording automatically — no extension update needed.

## Object

Create custom object **`NucleusTemplateUsage__c`** (label *"Nucleus Template Usage"*), same pattern as the other Nucleus objects, added to the Nucleus Templates app.

| Field | Type | Notes |
|---|---|---|
| `Name` | Auto Number, e.g. `USE-{00000}` | |
| **Template Name** → `Template_Name__c` | Text(255) | the inserted template's name |
| **Record Id** → `Record_Id__c` | Text(18) | the Salesforce record the user was on |
| **Record URL** → `Record_URL__c` | URL (or Text 255) | link back to that record |

Who/when come from the standard **Created By / Created Date** — no custom user fields needed. Exact API names don't matter; the extension discovers them from the describe (it looks for *templatename/template*, *recordid*, *recordurl/url*).

## Permissions

- **All extension users:** Create + Read. **No Edit, no Delete** (it's an audit log).
- Template admins additionally need Read on all records ("View All" on the object) so the manager's org-wide Usage view shows everyone's insertions.

## How it behaves in the extension

- Every insert is logged locally (per device, capped at 500) **and** fire-and-forget mirrored to this object once it exists. Failures are silent by design — a usage write can never break an insert.
- The Template Manager's **Usage** view automatically switches from the local log to the org-wide log (newest 200, with user names) when the object is detected. Admins only.
- The extension checks for the object at most once per service-worker lifetime, so a missing object costs essentially nothing.

## Test plan

1. Create the object + fields, grant Create/Read to a test user.
2. As that user, insert any template into a Notes field.
3. A `USE-…` record appears with Template Name / Record Id / URL, Created By = the user.
4. As a template admin, open Template Manager → Usage → it now shows the org-wide list.
