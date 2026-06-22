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

    // ── Describe-driven field resolution ──────────────────────────────────────
    // Salesforce auto-generates field API names from labels, so "Effective Date"
    // becomes Effective_Date__c but a hand-written API name might be
    // EffectiveDate__c. Rather than hardcode, we describe the object and match
    // fields by their NORMALISED name (lowercased, underscores + the __c suffix
    // removed), which makes both forms equivalent.

    var describeCache = Object.create(null);

    async function describeObject(base, token, obj) {
        var key = obj.toLowerCase();
        if (describeCache[key]) return describeCache[key];
        var res = await fetch(base + '/sobjects/' + obj + '/describe', {
            headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
        });
        if (!res.ok) throw new Error('describe ' + obj + ' failed: ' + res.status);
        var d = await res.json();
        describeCache[key] = d;
        return d;
    }

    function clearDescribeCache() { describeCache = Object.create(null); }

    function normalizeFieldName(name) {
        return String(name || '').toLowerCase().replace(/__c$/, '').replace(/_/g, '');
    }

    // conceptMap: { concept: [normalisedCandidate, ...] }. Returns { concept: actualApiName|null }.
    function resolveFields(fields, conceptMap) {
        var byNorm = Object.create(null);
        (fields || []).forEach(function (f) { byNorm[normalizeFieldName(f.name)] = f.name; });
        var out = {};
        Object.keys(conceptMap).forEach(function (concept) {
            var cands = conceptMap[concept];
            var found = null;
            for (var i = 0; i < cands.length; i++) {
                if (byNorm[cands[i]]) { found = byNorm[cands[i]]; break; }
            }
            out[concept] = found;
        });
        return out;
    }

    // First reference (lookup) field pointing at targetObject → { name, relationshipName }.
    function findReferenceField(fields, targetObject) {
        var t = String(targetObject || '').toLowerCase();
        for (var i = 0; i < (fields || []).length; i++) {
            var f = fields[i];
            if (f.type === 'reference' && (f.referenceTo || []).some(function (r) { return String(r).toLowerCase() === t; })) {
                return { name: f.name, relationshipName: f.relationshipName };
            }
        }
        return null;
    }

    return {
        soqlEscape: soqlEscape,
        isValidSfId: isValidSfId,
        isValidApiName: isValidApiName,
        describeObject: describeObject,
        clearDescribeCache: clearDescribeCache,
        normalizeFieldName: normalizeFieldName,
        resolveFields: resolveFields,
        findReferenceField: findReferenceField
    };

})();
