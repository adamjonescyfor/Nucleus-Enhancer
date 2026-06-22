# Salesforce setup — Suggest-an-edit (template change-requests)

Lets an ordinary analyst **propose** an edit to a template; a template admin reviews it (diff against the current version) and **Applies** (finalises in the editor and Saves — a normal versioned update) or **Rejects** it. The extension discovers everything below automatically — field API names are describe-discovered, so the exact names don't have to match.

## 1. New object: `NucleusTemplateChangeRequest__c`
Label **Template Change Request**. Record Name: **Auto Number** (records are created by the extension, never typed).

| Field | Type | Notes |
|---|---|---|
| `Template__c` | **Lookup → `NucleusTemplate__c`** (required) | which template the suggestion is for |
| `Proposed_Content__c` | **Long Text Area (max, e.g. 131072)** (required) | the analyst's proposed content |
| `Reason__c` | **Long Text Area** — **not required** ⚠️ | why they're suggesting it (the member may leave it blank, so this field must NOT be required) |
| `Status__c` | **Picklist** (required) — values **Pending / Approved / Rejected**, **default value = Pending** ⚠️ | new suggestions rely on this default; admins set it on review, members never write it |

The **who** and **when** come from the standard **CreatedBy / CreatedDate**. A suggestion never touches the template itself — applying it is always a deliberate admin Save through the normal editor.

## 2. Permissions / FLS
- **Everyone (all analysts):** **Create + Read** on `NucleusTemplateChangeRequest__c`; **editable + readable** FLS on `Template__c`, `Proposed_Content__c`, `Reason__c` (the extension sets these when they suggest); **read-only** FLS on `Status__c` (so they can see their request's status — they never set it; the field default makes a new one *Pending*). They read their **own** suggestions.
- **Template admins:** **Read all + Edit** (to set `Status__c`) — e.g. **View All / Modify All** on this object in the admin permission set. This is what powers the **Suggestions** review tab.
- No Delete needed for anyone.

## 3. How it behaves once live
- **Analysts** get a **"Suggest edit"** button next to *View* on each template in the read-only viewer → a box prefilled with the current content + a reason → **Send**.
- **Admins** get a **Suggestions** tab (with a count badge) listing pending suggestions. Each has **View diff** (suggested vs current), **Apply…** (marks it Approved and opens it in the editor prefilled, so you finalise formatting and Save through the normal versioned update), and **Reject**.
- Admins also get a once-a-day in-app nudge when suggestions are waiting.

No other setup is needed, and no extension update is required — the buttons and the Suggestions tab are part of the build already.
