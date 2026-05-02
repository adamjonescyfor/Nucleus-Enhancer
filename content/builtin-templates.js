// ==================================================
// CYFOR Nucleus Enhancer — Built-in Templates
// Templates that ship with the extension. These are
// merged with user-uploaded templates (user templates
// take precedence on name collision) and are always
// available even before the user uploads anything.
// ==================================================

Cyfor.builtinTemplates = {

    /**
     * Forensic Strategy — the standard template requested by the CTO.
     * Used for the Forensic Strategy RTF box on Nucleus cases.
     */
    'Forensic Strategy': [
        'FORENSIC STRATEGY TEMPLATE',
        '',
        'Case Overview',
        'Case Name / URN: ',
        'Case Type (eg Prosecution/Defence/Family/Corporate): ',
        'Police Force: ',
        'Instructing officer/solicitor: ',
        'Parties: ',
        'Alleged Offence(s): ',
        'Background: ',
        'Victim device submitted? (Y|N): ',
        '',
        'Devices & Data Sources',
        'Exhibit References: ',
        'PINs/Passwords: ',
        'Special handling required (eg fingerprints, biohazard): ',
        'USB/HDD exhibit ref: ',
        'Encrypted USB/HDD password: ',
        'Previous work undertaken (eg level 1, EPM): ',
        'Potential Limitations: ',
        '',
        'Objectives',
        'Data required/ points to prove: ',
        'Date range: ',
        '',
        'Acquisition Strategy',
        'Primary tool: ',
        'Secondary tool: ',
        '',
        'Processing Strategy',
        'Primary tool: ',
        'Secondary tool: ',
        'Griffeye required? (Y|N): ',
        'Grading required? (Y|N): ',
        'Keywords to be run? (Y|N): ',
        'CAID/ Hash sets to be run? (Y|N): ',
        '',
        'Analysis Strategy (if applicable)',
        'Timeline analysis? (Y|N): ',
        'User attribution (Y|N): ',
        'IIOC provenance? (Y|N): ',
        'Applications/artefacts to be examined: ',
        '',
        'Data Production Strategy',
        'Report template: ',
        'Generated material format: ',
        'Disclosures: '
    ].join('\n')
};

/**
 * 3-tier merge: built-ins → Salesforce remote → user uploads.
 * Higher tier wins on name collision.
 *
 * @param {object} userTemplates      - from chrome.storage.nucleusTemplates
 * @param {object} sfRemoteTemplates  - from chrome.storage.sfRemoteTemplates ({ name: { content, category } })
 * @returns {object} merged map of name → content string
 */
Cyfor.getMergedTemplates = function (userTemplates, sfRemoteTemplates) {
    var merged  = Object.create(null);
    var builtins = Cyfor.builtinTemplates || {};

    // Tier 3 (lowest): built-ins
    var builtinKeys = Object.keys(builtins);
    for (var i = 0; i < builtinKeys.length; i++) {
        merged[builtinKeys[i]] = builtins[builtinKeys[i]];
    }

    // Tier 2: Salesforce remote templates
    if (sfRemoteTemplates) {
        var remoteKeys = Object.keys(sfRemoteTemplates);
        for (var j = 0; j < remoteKeys.length; j++) {
            var entry = sfRemoteTemplates[remoteKeys[j]];
            // Entry may be { content, category } or a plain string
            merged[remoteKeys[j]] = (entry && typeof entry === 'object') ? entry.content : entry;
        }
    }

    // Tier 1 (highest): user-uploaded templates
    if (userTemplates) {
        var userKeys = Object.keys(userTemplates);
        for (var k = 0; k < userKeys.length; k++) {
            merged[userKeys[k]] = userTemplates[userKeys[k]];
        }
    }

    return merged;
};
