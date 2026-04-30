// ==================================================
// CYFOR Nucleus Enhancer — Notes Data
// Section headers, field labels, and lookup indexes
// used by the notes formatter.
// Separated from logic for maintainability.
// ==================================================

Cyfor.notesData = {

    /**
     * Section headers — standalone headings that begin a new section.
     * Sorted longest-first.
     */
    headers: [
        "Additional data provided along with reports (no timeframe)",
        "Additional data provided along with reports",
        "GENERATED EXHIBIT QA (Staffordshire Police)",
        "GENERATED EXHIBIT QA (Prosecution)",
        "IMPORT NOTIFICATIONS DIP SAMPLING",
        "GRAYKEY EXTRACTION COMPLETED",
        "GRIFFEYE PROCESSING COMPLETED",
        "Mobile Device Pre-Acquisition",
        "Mobile Device Pre-Imaging",
        "UFED EXTRACTION COMPLETED",
        "PRE-IMAGING QA (Prosecution)",
        "PROCESSING QA (Prosecution)",
        "EXHIBIT + GENERATED MATERIAL",
        "GRIFFEYE PROCESSING BEGAN",
        "HDD Device Pre-Acquisition",
        "SIM Card PA Processing",
        "SIM Card Report(s) Export",
        "IMAGING QA (Prosecution)",
        "REPORTING QA (MG22A)",
        "Work already completed",
        "RESEAL (Prosecution)",
        "SIM Card Reporting",
        "Graykey Extraction",
        "VICS Export Completed",
        "FastCopy Completed",
        "UFDR Creation Began",
        "Generated Exhibit QA",
        "Continuity Information",
        "Processing Information",
        "Additional Information",
        "Reporting Information",
        "Analysis Information",
        "Imaging Information",
        "Exhibit Information",
        "Device Information",
        "FastCopy Commence",
        "VICS Export Began",
        "Processing Commence",
        "Processing Complete",
        "Pa Processing Commence",
        "Pa Processing Complete",
        "Handset PA Processing",
        "SIM Card Pre-Imaging",
        "Forensic Strategy",
        "FastCopy Started",
        "UFED Extraction",
        "SIM Extraction",
        "Report Formats",
        "QA Information",
        "SIM acquisition",
        "Pre-Imaging QA",
        "Processing QA",
        "Reporting QA",
        "Tools/Method",
        "Booking in QA",
        "Griffeye case",
        "Limitations",
        "Faraday Box",
        "Photographs",
        "Disclosure",
        "Continuity",
        "Observations",
        "Completed",
        "Full case",
        "Summary",
        "Exhibit",
        "Details",
        "GM"
    ].sort((a, b) => b.length - a.length),

    /**
     * Field labels — key names that appear as "Label: value" or "Label - value".
     * Sorted longest-first automatically by buildIndexes().
     */
    fields: [
        "If new bag has been used, can previous bag details be seen through the bag, have details of previous bag been copied on the new bag",
        "Do all exhibit photos include details of the correctly referenced exhibit number, case reference and a synchronised clock",
        "Do exhibit photos include details of the correctly referenced exhibit number, case reference and a synchronised clock",
        "Has the generated exhibits drive been encrypted with BitLocker using client SLA password methodology",
        "Has the data been provided in the UFDR format unless specifically requested in an alternative format",
        "Has the generated exhibits drive been encrypted with BitLocker using 6 characters",
        "Does the content of the generated exhibits correspond with the case objectives",
        "If processing was unsuccessful/contained errors, was this raised to a Senior",
        "If processing had issues, was the log saved and added to VHDX and Nucleus",
        "Has the continuity and 'Bag opened by' sections been signed on the exhibit bag",
        "Is the content coherent, and have all required sections been completed",
        "Has the continuity label been signed on the incoming exhibit bag",
        "Applications list / Apps Library (please note: not all apps are shown",
        "If Special Handling required, what PPE was used",
        "Have Pre-Imaging boxes and Notes section been completed with correct details",
        "Have Pre-Imaging boxes and Notes section been completed",
        "Do the contemporaneous notes contain the minimum requirements",
        "Was the most up to date authorised version used and recorded",
        "Have Imaging boxes and Notes section been completed with correct details",
        "Have Imaging boxes and Notes section",
        "Has a manual review been conducted for items of interest not extracted",
        "Have Start & Finish processing notes been added",
        "Was the most up to date, authorised software version used",
        "Has the spelling and grammar of the report been reviewed",
        "Has the Technical Report & Password been added",
        "Are you able to open the generated exhibits using the password provided",
        "Are you able to open the generated exhibits",
        "Does the content of the generated exhibits correspond",
        "Has the generated exhibit been AV scanned and screenshot uploaded",
        "Have all the exhibit re-seal numbers been recorded",
        "Has the correct naming convention been used for reports and generated material as per SLA",
        "Trace Window process log saved and uploaded to Nucleus",
        "All screens including folders and their content",
        "Attempted to unlock the handset with provided PIN at",
        "Did the Import Notifications have any errors/exemptions",
        "Has a Forensic Strategy been completed",
        "Have sub-exhibits been given the correct naming convention",
        "If not, why not and has this been authorised appropriately",
        "Has the extraction progress report/log been uploaded to Nucleus",
        "Was the processing completed without errors",
        "Has the correct template and latest version been used",
        "Are the generated exhibits encrypted as per CY-LAB-005",
        "Has the generated exhibit been AV scanned",
        "Has the exhibit been checked/redacted",
        "Exhibit bag shows seal, CYFOR/Police label and seal number",
        "Seal Number checked against Nucleus",
        "Seal Number Checked against CMS",
        "If NOT, what corrective action was taken",
        "Device power state at time of opening",
        "SIM tray photographed (including details printed on the tray)",
        "Apple devices: A-model number photographed",
        "Device Placed in Faraday Box at",
        "Attempted to power on the handset at",
        "Removed the handset from the Faraday Box at",
        "Signed in Apple/Google/Samsung accounts",
        "Total number of import notifications",
        "Was the processed number of files satisfactory",
        "Have all required photographs of the device been taken",
        "Have sub-exhibits been photographed",
        "Has the extraction progress report",
        "Has a sense check been undertaken",
        "Was re-processing conducted",
        "Has the processing log been uploaded",
        "For Leicestershire Police",
        "Is the report structured correctly",
        "Is the content coherent",
        "Has the MG22(e) declaration been added",
        "Has the correct naming convention been used",
        "Has the GM entry been created",
        "Has OneDrive entry been created",
        "Has the exhibit been re-sealed",
        "Has the re-seal tape been dated",
        "Have all re-seal events photos been taken",
        "Has the MG22A been added",
        "Have photos been added",
        "Has UFDR report remained unzipped",
        "Has PDF/Excel report been zipped",
        "Has the correct folder structure been used",
        "Device powered on at time of opening",
        "If yes, what corrective action was taken",
        "Do we have everything required to begin the work",
        "Collected the exhibit from secure storage. Location updated at",
        "Any issued relating continuity",
        "If NOT, explain the issue",
        "Exhibit Reference matches Nucleus",
        "Bluetooth, Wi-Fi and Location Services",
        "Any changes made to default settings",
        "If processing was unsuccessful",
        "Exhibit bag showing seal, CYFOR label and seal number",
        "Defendant/Suspect name",
        "Client/Contact name",
        "USB/HDD exhibit ref",
        "Encrypted USB/HDD password",
        "Notes to examiner",
        "Special Handling checked",
        "If ON, what actions were taken",
        "Device condition photographed",
        "Removable media identified",
        "Removable media type",
        "Lock screen photographed",
        "Main screen photographed",
        "Control/Action Centre",
        "Apps in the background",
        "Secure areas photographed",
        "Copying progress checked at",
        "Completed successfully",
        "Griffeye Processing began at",
        "Was processing completed successfully",
        "Will the data be reprocessed",
        "Processing results",
        "Has the continuity been signed",
        "Were sub-exhibits acquired",
        "Errors dip sampled",
        "Camera Date/Time verified",
        "Clock Date/Time verified",
        "Exhibit ID matches Nucleus",
        "Location updated at",
        "If YES: explain",
        "SIM/Tray removed at",
        "SIM tray photographed",
        "Faraday Box asset",
        "iOS: Touch ID & Passcode",
        "Copy start date/time", "Copy end date/time",
        "Errors reviewed",
        "Errors reviewed by",
        "Copying retaken",
        "1st Attempt",
        "Database Category",
        "All Files Selected",
        "Property Number",
        "No settings changed", "No settings Changed",
        "Tool Used to process",
        "Date & Time Unsealed",
        "Computer Workstation",
        "Have logs been attached",
        "Is the data readable",
        "Copying successfully",
        "Faraday Box Used",
        "Photos started", "Photos finished",
        "Camera Asset", "Clock Asset", "SD Card Asset",
        "Continuity Signed",
        "Device Placed in Faraday Box",
        "Device Powered On",
        "Device Unlocked",
        "Device Removed from Faraday",
        "Flight mode activated",
        "Bluetooth, Wi-Fi and Location Services disabled",
        "Bluetooth, WiFi and Location Services disabled",
        "Lock screen settings",
        "Lock screen setting",
        "Photos Taken",
        "Settings changed",
        "Instruction of",
        "Data required",
        "Camera asset",
        "Camera card asset",
        "Clock asset",
        "Seal Intact",
        "Airplane Mode", "Aeroplane Mode", "Flight Mode",
        "Checked for eSIM",
        "Notifications",
        "Hidden apps",
        "About phone",
        "No. of errors",
        "Commenced at",
        "Not Selected",
        "Device Type",
        "If not, explain why",
        "Serial Number", "Serial No",
        "Phone Number", "Phone No",
        "Network Provider",
        "Physical Condition",
        "Storage Capacity",
        "Software Version",
        "Location Services",
        "Extraction Type",
        "Software Used",
        "Screen Lock", "Lock Type",
        "Evidence Ref", "Exhibit Ref",
        "Case Number", "Case No", "Case Ref",
        "Seal Number", "Seal No", "Bag Number",
        "File Size",
        "OS Version",
        "Logs attached",
        "Version used",
        "Tool Used",
        "Encryption",
        "Condition", "Damage",
        "SIM Card",
        "Firmware",
        "Network",
        "Storage",
        "Photograph",
        "Commenced", "Completed",
        "Case Ref",
        "Job type",
        "Crime type",
        "Timeframe",
        "Lock type",
        "Time Zone",
        "Calendar",
        "Used Tool",
        "Tool used",
        "VICS used",
        "Imported",
        "Selected",
        "Source ID",
        "Excluded",
        "Make", "Model", "IMEI", "Colour", "Color",
        "PIN", "Pattern", "Password", "Passcode",
        "Description", "Assets",
        "Date/Time",
        "Examiner", "Analyst", "Operator",
        "Status", "Result", "Outcome",
        "MD5", "SHA1", "SHA256", "Hash",
        "Capacity",
        "Reference", "Ref",
        "Version", "Photos", "Comments", "Remarks", "Notes",
        "Subject", "Comment", "Errors", "Tool", "Included"
    ].sort((a, b) => b.length - a.length),

    // Pre-built indexes
    headerSet: null,
    fieldByFirstWord: null,

    /**
     * Build fast lookup indexes from the raw arrays.
     * Called once during initialisation.
     */
    buildIndexes() {
        // Lowercase set of all headers for O(1) lookup, aggressively stripping non-alphanumerics to match fuzzy formatting
        this.headerSet = new Set(
            this.headers.map(h => h.toLowerCase().replace(/[*#]/g, '').replace(/^[\s:–\-]+|[\s:–\-]+$/g, '').replace(/\s+/g, ' ').trim())
        );

        // Map first word → array of candidate fields
        this.fieldByFirstWord = Object.create(null);
        for (const field of this.fields) {
            const firstWord = field.split(/[\s:?\-]/)[0].toLowerCase();
            if (!this.fieldByFirstWord[firstWord]) {
                this.fieldByFirstWord[firstWord] = [];
            }
            this.fieldByFirstWord[firstWord].push(field);
        }
    },

    /**
     * Check if a line matches a known section header.
     * Aggressively strips asterisks and punctuation so "*** HANDSET *** PA PROCESSING:" matches "Handset PA Processing"
     */
    isKnownHeader(line) {
        if (!this.headerSet) this.buildIndexes();

        const normalised = line
            .toLowerCase()
            .replace(/[*#]/g, '') // strip all decorative asterisks and hashes
            .replace(/^[\s:–\-]+|[\s:–\-]+$/g, '') // strip leading/trailing separators
            .replace(/\s+/g, ' ')
            .trim();

        return this.headerSet.has(normalised);
    },

    /**
     * Check if a line starts with a known field label.
     */
    isKnownFieldStart(line) {
        if (!this.fieldByFirstWord) this.buildIndexes();

        const lineLower = line.toLowerCase();
        const firstWord = lineLower.split(/[\s:?\-]/)[0];
        const candidates = this.fieldByFirstWord[firstWord];

        if (!candidates) return false;
        
        return candidates.some(f => {
            const fieldLower = f.toLowerCase();
            if (!lineLower.startsWith(fieldLower)) return false;
            
            const after = lineLower.substring(fieldLower.length);
            if (fieldLower.endsWith('?')) return true;
            if (/^\s*[:\-–—]/.test(after)) return true;
            if (/^\s+\S/.test(after) && fieldLower.length > 12) return true;
            if (after.trim() === '') return true;

            return false;
        });
    }
};

// Build indexes immediately so they're ready when notes are first formatted
Cyfor.notesData.buildIndexes();