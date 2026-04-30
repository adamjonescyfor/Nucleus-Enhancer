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
 * Merge built-in templates with user-uploaded templates.
 * User templates take precedence on name collision.
 *
 * @param {object} userTemplates - templates loaded from chrome.storage
 * @returns {object} merged templates
 */
Cyfor.getMergedTemplates = function (userTemplates) {
    const merged = Object.create(null);
    const builtins = Cyfor.builtinTemplates || {};

    // Built-ins first
    for (const key of Object.keys(builtins)) {
        merged[key] = builtins[key];
    }

    // User templates override built-ins of the same name
    if (userTemplates) {
        for (const key of Object.keys(userTemplates)) {
            merged[key] = userTemplates[key];
        }
    }

    return merged;
};
