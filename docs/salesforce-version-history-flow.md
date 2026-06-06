# Salesforce spec — automatic version history for Nucleus Templates

**For:** Callum (Salesforce admin)
**Goal:** make **every** change to a template create a version-history snapshot — including edits made **directly in Salesforce**, not just edits made through the Nucleus Enhancer extension. This closes the only gap between "manage in the extension" and "manage in Salesforce".

---

## Background (how it works today)

- Templates are `NucleusTemplate__c` records.
- Version history is stored as `NucleusTemplateVersion__c` records (one per past revision), linked back to the template by a lookup.
- **Today** the extension does the archiving: before it overwrites a template it first creates a `NucleusTemplateVersion__c` holding the *previous* content. So history is captured **only when someone edits via the extension**. A direct edit in Salesforce updates the record but leaves no snapshot.

This spec moves that archiving into a **record‑triggered Flow** on `NucleusTemplate__c` so it happens for **all** edits, from any source.

> **Coordination (important):** once this Flow is live, the extension's own archiving must be turned off, otherwise extension edits would create **two** snapshots. Tell Adam / the developer when the Flow is deployed and they'll remove the extension‑side archive in one line. Until then, leave the extension as‑is (it keeps history working without the Flow).

---

## Prerequisites — fields that must exist

**`NucleusTemplate__c`** (the template):
| Purpose | Typical label / API name |
|---|---|
| Body | **Content** / `Content__c` (Long Text Area) |
| Version | **Version Label** / `Version_Label__c` (Text) |
| Reason for the change | **Reason for Change** / `Reason_for_Change__c` (Text/Long Text) |

**`NucleusTemplateVersion__c`** (one archived revision):
| Purpose | Typical label / API name |
|---|---|
| Link to the template | **Template** / lookup → `NucleusTemplate__c` (e.g. `Template__c`) |
| Archived body | **Content** / `Content__c` (Long Text Area) |
| Archived version | **Version Label** / `Version_Label__c` (Text) |
| Reason for the change | **Reason for Change** / `Reason_for_Change__c` (Text/Long Text) |
| *(optional)* When archived | **Archived At** / `Archived_At__c` (Date/Time) — optional; the standard **Created Date** already records this |

Who/when is captured automatically by the standard **Created By** / **Created Date** on the version record — no custom "changed by" fields are needed. *(Use your real API names; the extension already auto‑detects them, the Flow needs them spelled exactly.)*

---

## Build it — Record‑Triggered Flow (recommended)

Setup → **Flows** → **New Flow** → **Record‑Triggered Flow**.

1. **Object:** `NucleusTemplate__c`
2. **Trigger:** *A record is updated*
3. **Entry Conditions:** *Only when a record is updated to meet the condition requirements* →
   `Content__c` **Is Changed** = `True`
   *(This snapshots a revision whenever the body changes. If you'd rather snapshot on every version bump instead, use `Version_Label__c` Is Changed = True.)*
4. **Optimize the Flow for:** **Actions and Related Records** (this is an *after‑save* flow — it must be after‑save to create a related record).
5. Add one element → **Create Records** → *Create a Record* of `NucleusTemplateVersion__c`, and set its fields **from the PRIOR values** of the template:

   | Version record field | Set to (Flow value) | Notes |
   |---|---|---|
   | `Template__c` (lookup) | `{!$Record.Id}` | links the snapshot to its template |
   | `Content__c` | `{!$Record__Prior.Content__c}` | the **previous** body (what we're archiving) |
   | `Version_Label__c` | `{!$Record__Prior.Version_Label__c}` | the **previous** version label |
   | `Reason_for_Change__c` | `{!$Record.Reason_for_Change__c}` | the **new** record's reason (why it changed) |
   | `Archived_At__c` *(if present)* | `{!$Flow.CurrentDateTime}` | optional |

   The key detail: **Content** and **Version Label** come from `$Record__Prior` (the values *before* this edit), while **Reason** comes from `$Record` (the reason entered for *this* edit). That matches exactly what the extension stores today.

6. **Save** (e.g. "Nucleus Template — Archive Prior Version") and **Activate**.

That's it. Created By / Created Date on each new version record are set by Salesforce to the user who made the edit and the time — so "Changed By" in the extension's History tab stays accurate for direct edits too.

---

## Alternative — Apex trigger (if you prefer code)

A bulk‑safe `after update` trigger on `NucleusTemplate__c` that, for each record whose `Content__c` changed, inserts a `NucleusTemplateVersion__c` populated from `Trigger.oldMap` (prior values). Same field mapping as the table above. The Flow is recommended unless you already manage these objects in Apex.

---

## Test plan

1. **Direct‑in‑Salesforce edit:** open a `NucleusTemplate__c`, change the **Content**, set a **Reason for Change**, save. → A new `NucleusTemplateVersion__c` appears holding the **old** content + old version label + the reason, with **Created By = you**.
2. **Extension edit (after the extension‑side archive is removed):** edit the same template via the manager. → Exactly **one** new version is created (not two).
3. **No‑op edit:** change only a non‑content field (e.g. Review Due Date). → **No** version is created (entry condition not met).
4. **Extension History tab:** open the template's History in the manager → the new snapshot is listed with the right version, date, person and reason, and **Compare** shows the diff.

---

## Summary of the one decision

Pick **where** archiving lives:
- **Flow only (recommended)** — one mechanism, identical for every edit source. Requires the small extension change to stop double‑archiving (developer, one line).
- **Extension only (today)** — works without any Salesforce config, but direct‑in‑Salesforce edits aren't snapshotted.

Once the Flow is active, tell the developer to drop the extension's `archiveCurrentVersion` call on update, and the two systems are fully in parity.
