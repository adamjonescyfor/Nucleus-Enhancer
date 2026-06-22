// ==================================================
// CYFOR Nucleus Enhancer — Built-in Templates
// No templates ship with the extension anymore — official
// templates (incl. Forensic Strategy) are managed centrally
// in Salesforce and synced down. This object is kept empty so
// the merge logic below still works.
// ==================================================

Cyfor.builtinTemplates = {};

/**
 * Merge tiers (lowest → highest priority): built-ins → user uploads → Salesforce.
 * Official (Salesforce-synced) templates take priority and CANNOT be overridden
 * by a user upload of the same name — they are the authoritative set.
 *
 * @param {object} userTemplates      - from chrome.storage.nucleusTemplates
 * @param {object} sfRemoteTemplates  - from chrome.storage.sfRemoteTemplates ({ name: { content, category } })
 * @returns {object} merged map of name → content string
 */
Cyfor.getMergedTemplates = function (userTemplates, sfRemoteTemplates) {
    var merged  = Object.create(null);
    var builtins = Cyfor.builtinTemplates || {};

    // Tier 3 (lowest): built-ins (none ship now)
    var builtinKeys = Object.keys(builtins);
    for (var i = 0; i < builtinKeys.length; i++) {
        merged[builtinKeys[i]] = builtins[builtinKeys[i]];
    }

    // Tier 2: user-uploaded templates
    if (userTemplates) {
        var userKeys = Object.keys(userTemplates);
        for (var k = 0; k < userKeys.length; k++) {
            merged[userKeys[k]] = userTemplates[userKeys[k]];
        }
    }

    // Tier 1 (highest): Salesforce official templates — win every collision.
    if (sfRemoteTemplates) {
        var remoteKeys = Object.keys(sfRemoteTemplates);
        for (var j = 0; j < remoteKeys.length; j++) {
            var entry = sfRemoteTemplates[remoteKeys[j]];
            // Entry may be { content, category } or a plain string
            merged[remoteKeys[j]] = (entry && typeof entry === 'object') ? entry.content : entry;
        }
    }

    return merged;
};
