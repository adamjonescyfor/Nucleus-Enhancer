// ==================================================
// CYFOR Nucleus Enhancer — Salesforce helpers (background)
// Small shared utilities for safely building SOQL.
//
// Defense-in-depth: even though the values we interpolate come from
// the user's own page/org via their own OAuth token (not a privilege
// boundary), we still escape strings and validate IDs so a stray quote
// or unexpected value can never alter a query's structure.
//
// Exposes: self.SfUtils.{ soqlEscape, isValidSfId, isValidApiName }
// ==================================================

self.SfUtils = (function () {

    // Escape a value for safe inclusion inside a single-quoted SOQL string
    // literal. SOQL uses backslash escaping, so the backslash itself must be
    // escaped first, then the single quote.
    function soqlEscape(value) {
        return String(value == null ? '' : value)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'");
    }

    // Salesforce record IDs are 15 (case-sensitive) or 18 (case-insensitive)
    // characters, alphanumeric only.
    function isValidSfId(id) {
        return typeof id === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id);
    }

    // Object/field API names: letters, digits, and underscores only
    // (covers custom objects like Exhibit_Process__c and relationships).
    function isValidApiName(name) {
        return typeof name === 'string' && /^[a-zA-Z0-9_]+$/.test(name);
    }

    return { soqlEscape: soqlEscape, isValidSfId: isValidSfId, isValidApiName: isValidApiName };

})();
