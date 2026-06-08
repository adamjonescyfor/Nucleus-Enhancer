// ==================================================
// CYFOR Nucleus Enhancer — Notes Formatter
// Parses raw concatenated note text from list view cells
// and renders structured, readable HTML.
// ==================================================

Cyfor.notes = {
    _intervalId: null,

    /**
     * Start or stop the notes formatter based on config.
     */
    handleState() {
        document.body.classList.toggle('cyfor-format-notes-enabled', Cyfor.config.enableFormatNotes);

        if (Cyfor.config.enableFormatNotes) {
            this._startScanning();
        } else {
            this._stopScanning();
        }
    },

    _startScanning() {
        this.formatAll();
    },

    _stopScanning() {
        // interval removed — formatAll is now triggered by _onDomChange
    },

    /**
     * Format all visible note cells.
     */
    formatAll() {
        if (Cyfor.utils.isContextInvalid()) return;

        const cells = Cyfor.utils.querySelectorAllDeep(
            'td[data-label*="Notes"] .slds-truncate, td[data-label*="Notes"] .slds-hyphenate'
        );

        for (const cell of cells) {
            this._formatCell(cell);
        }
    },

    /**
     * Format a single note cell.
     * Skips cells that already contain formatted output.
     */
    _formatCell(cell) {
        // Skip if already formatted and our HTML is still present
        if (cell.querySelector('.cyfor-note')) return;

        // Preserve the original raw text, dynamically reading HTML paragraphs to prevent glued text.
        let raw = cell.getAttribute('data-cyfor-raw');
        if (!raw) {
            // Walk the live cell DOM without cloning, extracting text with newlines for block elements
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
            let text = '';
            let node = walker.nextNode();
            while (node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    text += node.textContent;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName;
                    if (tag === 'BR') {
                        text += '\n';
                    } else if (tag === 'P' || tag === 'DIV' || tag === 'LI') {
                        if (text.length > 0 && !text.endsWith('\n')) text += '\n';
                    }
                }
                node = walker.nextNode();
            }
            
            // Fallback: Salesforce sometimes puts perfectly formatted text inside the hover title attribute
            const spanWithTitle = cell.querySelector('span[title]');
            if (spanWithTitle) {
                const titleText = spanWithTitle.getAttribute('title') || '';
                // If title has line breaks and ours doesn't, or if it has MORE text, use the title attribute
                if (titleText.length > text.length || (titleText.includes('\n') && !text.includes('\n'))) {
                    text = titleText;
                }
            }

            // Clean up excess spacing we might have generated
            raw = text.replace(/\n{3,}/g, '\n\n').trim();
            cell.setAttribute('data-cyfor-raw', raw);
        }

        if (!raw || !raw.trim()) return;

        // Build formatted HTML
        const html = this._parse(raw.trim());
        cell.innerHTML = `<div class="cyfor-note">${html}</div>`;
    },

    // ========================================
    // PARSER
    // ========================================

    /**
     * Main parser: raw text → structured HTML.
     */
    _parse(raw) {
        let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        text = text.replace(/[^\S\n]+/g, ' ');   // collapse spaces/tabs (keep newlines)
        text = text.replace(/ *\n */g, '\n');     // trim each line's edges
        text = text.replace(/\n{3,}/g, '\n\n');
        text = text.trim();

        if (!text) return `<div class="cyfor-n-text">${Cyfor.utils.escapeHtml(raw)}</div>`;

        const nlCount = (text.match(/\n/g) || []).length;
        let lines;

        if (nlCount >= 2) {
            // STRUCTURED: the note already has line breaks — trust them. Only ungue an
            // INDIVIDUAL line that is clearly concatenated. This stops the historic
            // over-splitting of well-formed templates (e.g. "GrayKey" -> "Gray Key",
            // "[ExhibRef]" -> "[Exhib Ref]", "Case reference - YES/NO" being torn apart).
            lines = [];
            for (const ln of text.split('\n')) {
                if (ln === '') { lines.push(''); continue; }
                if (this._looksGlued(ln)) {
                    for (const piece of this._splitAtBreakPoints(ln, this._findBreakPoints(ln))) lines.push(piece);
                } else {
                    lines.push(ln);
                }
            }
        } else {
            // GLUED: little/no line structure (e.g. a truncated list-view cell that
            // concatenated everything) — reconstruct the breaks heuristically.
            const breakPoints = this._findBreakPoints(text);
            for (let i = 0; i < text.length; i++) if (text[i] === '\n') breakPoints.add(i);
            lines = this._mergeFragments(this._splitAtBreakPoints(text, breakPoints));
        }

        return this._buildHtml(lines, raw);
    },

    /**
     * Heuristic: does this single line look like several lines concatenated WITHOUT
     * a break (so it needs un-gluing)? Conservative — only fires on clear glue
     * signatures, so normal long sentences and "Label - value" lines are left alone.
     */
    _looksGlued(line) {
        if (line.length < 45) return false;
        if (/^[-–—_=*\s]+$/.test(line)) return false; // a pure divider rule is not "glued"

        // Count glue signatures. A single CamelCase word (e.g. "GrayKey") in an
        // otherwise clean line scores 1 and is left alone; concatenated cells score
        // several (many CamelCase/number joins, colon-glue, sentence-glue…) and get
        // un-glued. Threshold of 2 keeps real tokens safe while catching free-form
        // notes that Salesforce ran together.
        let signals = 0;
        if (/[a-z0-9]:[A-Z]/.test(line)) signals++;          // word:Word
        if (/\d:\d{2}[A-Za-z]/.test(line)) signals++;         // 12:02Word
        if (/\b(?:YES|NO|N\/A)[A-Za-z]/.test(line)) signals++; // YESWord
        if (/[^\s\-–—_=*][-–—_=*]{5,}/.test(line)) signals++;  // text-----
        if (/[a-z]\.[A-Z]/.test(line)) signals++;              // word.Word (sentence glued)
        signals += (line.match(/[a-z]{3}[A-Z][a-z]/g) || []).length; // CamelCase joins
        signals += (line.match(/[\d\])][A-Z][a-z]/g) || []).length;  // 3Word / )Word / ]Word
        return signals >= 2;
    },

    /**
     * Scan text for positions where a line break should be inserted.
     */
    _findBreakPoints(text) {
        const bp = new Set();
        const textLower = text.toLowerCase();
        const data = Cyfor.notesData;

        // Before known section headers
        for (const header of data.headers) {
            this._findPatternBreaks(text, textLower, header, bp);
        }

        // Before known field labels
        for (const field of data.fields) {
            this._findFieldBreaks(text, textLower, field, bp);
        }

        // Regex-based transition patterns (ungluing logic)
        this._findRegexBreaks(text, bp);

        return bp;
    },

    _findPatternBreaks(text, textLower, pattern, breakPoints) {
        const patternLower = pattern.toLowerCase();
        let searchFrom = 0;

        while (true) {
            const idx = textLower.indexOf(patternLower, searchFrom);
            if (idx === -1) break;

            const charBefore = idx > 0 ? text[idx - 1] : ' ';
            const charAfter = text[idx + pattern.length] || ' ';

            const validBefore = /[\s\n.,;:!?()\-–—*#]/.test(charBefore) || idx === 0;
            const validAfter = /[\s\n:.,;!?()\-–—*#]/.test(charAfter) || (idx + pattern.length) >= text.length;

            if (validBefore && validAfter) {
                breakPoints.add(idx);
            }

            searchFrom = idx + 1;
        }
    },

    _findFieldBreaks(text, textLower, field, breakPoints) {
        const fieldLower = field.toLowerCase();
        let searchFrom = 0;

        while (true) {
            const idx = textLower.indexOf(fieldLower, searchFrom);
            if (idx === -1) break;

            const charBefore = idx > 0 ? text[idx - 1] : ' ';
            const afterIdx = idx + field.length;

            const validBefore = /[\s\n.,;:!?()\-–—]/.test(charBefore) || idx === 0;
            const endsWithQ = field.endsWith('?');
            const afterText = text.substring(afterIdx, afterIdx + 4);
            const validAfter = endsWithQ ||
                /^[\s]*[:?\-–—]/.test(afterText) ||
                /^[\s]+[A-Z0-9]/.test(afterText);

            if (validBefore && validAfter) {
                breakPoints.add(idx);
            }

            searchFrom = idx + 1;
        }
    },

    _findRegexBreaks(text, bp) {
        const patterns = [
            // Split BEFORE 5+ dashes/asterisks if glued to text
            {
                regex: /([^\s\n])(\s*[-–—_=*]{5,})/g,
                offsetFn: (m) => m.index + 1
            },
            // Split AFTER 5+ dashes/asterisks if glued to text
            {
                regex: /([-–—_=*]{5,}\s*)([^\s\n])/g,
                offsetFn: (m) => m.index + m[1].length
            },
            // Colon glued immediately to a capital letter or number (e.g. "PROCESSING:Cellebrite", "Time:12:02")
            {
                regex: /(:)([A-Z0-9])/g,
                offsetFn: (m) => m.index + 1,
                filter: (m, txt) => {
                    // Don't split timestamps: number before colon → it's a time (e.g. 12:02)
                    if (/[0-9]/.test(m[2])) {
                        const charBefore = m.index > 0 ? txt[m.index - 1] : '';
                        if (/[0-9]/.test(charBefore)) return false;
                    }
                    // Don't split forensic codes like REF:, HASH:, CASE:, SHA1: (M-11)
                    const prefix = txt.substring(Math.max(0, m.index - 6), m.index);
                    if (/\b[A-Z]{2,6}$/.test(prefix)) return false;
                    return true;
                }
            },
            // Non-whitespace character glued to a Time pattern (e.g. "(Android)12:02" or "PA.12:02")
            {
                regex: /([^\s])(\d{1,2}:\d{2}(?:\s*(?:am|pm))?\s*[-–a-zA-Z])/gi,
                offsetFn: (m) => m.index + m[1].length,
                filter: (m) => !/^[\d:]$/.test(m[1]) // Don't break if it's just part of a larger number string
            },
            // Time pattern glued immediately to a letter (e.g. "12:02amSamsung" or "10:31Continuity")
            {
                regex: /(\d{1,2}:\d{2}(?:\s*(?:am|pm))?)([a-zA-Z])/gi,
                offsetFn: (m) => m.index + m[1].length
            },
            // "YES", "NO", "N/A" glued immediately to a Capital letter (e.g. "YESCamera")
            {
                regex: /\b(YES|NO|N\/A)([A-Z])/g,
                offsetFn: (m) => m.index + m[1].length
            },
            // Digit glued to a Capital-led word (e.g. "verified 3Discord", "0769Unsealed").
            // Requires the capital to start a real word (Upper+lower) so versions/codes
            // like "MG22A" or "2.0" aren't split.
            {
                regex: /(\d)([A-Z][a-z])/g,
                offsetFn: (m) => m.index + 1
            },
            // Closing bracket/paren glued to a Capital-led word (e.g. "[257]Excluded", "(86)Error").
            {
                regex: /([\])])([A-Z][a-z])/g,
                offsetFn: (m) => m.index + 1
            },
            // CamelCase gluing (e.g. "NotesLive", "MediaTotal", "extractionChatGPT",
            // "TeleguardUnsealed"). This ONLY runs on text already judged "glued"
            // (concatenated cells), never on clean template lines — so real tokens like
            // "GrayKey"/"[ExhibRef]" on their own line are untouched.
            {
                regex: /([a-z]{3,})([A-Z][a-z])/g,
                offsetFn: (m) => m.index + m[1].length
            },
            // Sentence boundary glued: period + Capital letter (e.g. "Nucleus.Seal")
            {
                regex: /([.?!])([A-Z])/g,
                offsetFn: (m) => m.index + 1,
                filter: (m, txt) => {
                    const before = txt.substring(Math.max(0, m.index - 5), m.index);
                    if (/\b[A-Z]$/.test(before)) return false; // Prevent splitting acronyms like U.S.A.
                    return true;
                }
            }
        ];

        for (const { regex, offsetFn, filter } of patterns) {
            regex.lastIndex = 0; 
            let match;
            while ((match = regex.exec(text)) !== null) {
                if (filter && !filter(match, text)) continue;
                let pos = offsetFn(match);
                while (pos < text.length && text[pos] === ' ') pos++;
                if (pos > 0 && pos < text.length) bp.add(pos);
            }
        }
    },

    _splitAtBreakPoints(text, breakPoints) {
        const sorted = [...breakPoints].sort((a, b) => a - b);
        const lines = [];
        let lastPos = 0;

        for (const pos of sorted) {
            if (pos > lastPos) {
                const segment = text.substring(lastPos, pos).trim();
                if (segment) lines.push(segment);
            } else if (pos === lastPos && text[pos] === '\n') {
                lines.push('');
            }
            lastPos = pos;
            if (text[pos] === '\n') lastPos = pos + 1;
        }

        if (lastPos < text.length) {
            const segment = text.substring(lastPos).trim();
            if (segment) lines.push(segment);
        }

        return lines;
    },

    _mergeFragments(lines) {
        const merged = [];

        for (const line of lines) {
            if (line === '') {
                merged.push('');
                continue;
            }

            if (merged.length > 0 && merged[merged.length - 1] !== '') {
                const prev = merged[merged.length - 1];
                
                const isLowercaseContinuation = /^[a-z]/.test(line) && !/[.!?:]\s*$/.test(prev);
                
                // If the previous line ends with a dash/hyphen, OR is a standalone timestamp, we MERGE the next line.
                // This fixes issues where "12:09 -" ends up on its own line above "Selected"
                const isPrevDangling = (/(?:[-–—]\s*)$/.test(prev) || /^\d{1,2}:\d{2}(?:\s*(?:am|pm))?\s*$/i.test(prev)) && !/^[-–—_=*]{5,}$/.test(prev);

                if (isPrevDangling) {
                    merged[merged.length - 1] = prev + (prev.endsWith(' ') ? '' : ' ') + line;
                    continue;
                }

                if (isLowercaseContinuation && !Cyfor.notesData.isKnownHeader(line) && !Cyfor.notesData.isKnownFieldStart(line)) {
                    merged[merged.length - 1] = prev + ' ' + line;
                    continue;
                }
            }

            merged.push(line);
        }

        return merged;
    },

    _buildHtml(lines, raw) {
        let html = '';
        let sectionOpen = false;
        const esc = Cyfor.utils.escapeHtml;
        const closeSection = () => { if (sectionOpen) { html += '</div>'; sectionOpen = false; } };
        const openSection  = () => { if (!sectionOpen) { html += '<div class="cyfor-n-section">'; sectionOpen = true; } };
        const emitHeader   = (txt) => {
            closeSection();
            html += '<div class="cyfor-n-section">';
            html += `<div class="cyfor-n-header">${esc(txt)}</div>`;
            sectionOpen = true;
        };

        for (const line of lines) {
            if (line === '') continue;

            // Manual horizontal rule (e.g. "----------------------")
            if (/^[-–—_=*]{5,}$/.test(line)) {
                closeSection();
                html += '<hr class="cyfor-n-divider" />';
                continue;
            }

            // Known section header from the curated library
            if (Cyfor.notesData.isKnownHeader(line)) {
                emitHeader(line.replace(/[*#]/g, '').replace(/^[\s:–\-]+|[\s:–\-]+$/g, ''));
                continue;
            }

            // Prefix headings (e.g. "MB3: 27/01/2026 - PRE-IMAGING" or "KW3 - 10:15am")
            if (/^([A-Z0-9]{2,8}\s*[-–:]\s*\d{1,2}:\d{2}(?:am|pm)?|[A-Z0-9]+:\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*[-–]\s*.+)$/i.test(line)) {
                emitHeader(line);
                continue;
            }

            // Bullet points ("- item", "* item", "• item")
            const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
            if (bulletMatch) {
                openSection();
                html += `<div class="cyfor-n-text cyfor-n-bullet">${this._colorize(esc(bulletMatch[1]))}</div>`;
                continue;
            }

            // Key: value — colon, dash-separated, question, or empty-value label
            const kv = this._parseKeyValue(line);
            if (kv) {
                openSection();
                html += '<div class="cyfor-n-row' + (kv.value ? '' : ' cyfor-n-row-label') + '">';
                html += `<span class="cyfor-n-key">${esc(kv.key)}${kv.sep}</span>`;
                if (kv.value) html += ` <span class="cyfor-n-val">${this._colorize(esc(kv.value))}</span>`;
                html += '</div>';
                continue;
            }

            // Heuristic heading: a short title line (e.g. "GrayKey Imaging Commence",
            // "Grading Notes", "Generated Material") that isn't in the library.
            if (this._looksLikeHeader(line)) {
                emitHeader(line.replace(/[*#]/g, '').trim());
                continue;
            }

            // Plain text
            openSection();
            html += `<div class="cyfor-n-text">${this._colorize(esc(line))}</div>`;
        }

        closeSection();
        return html || `<div class="cyfor-n-text">${esc(raw)}</div>`;
    },

    // Section-keyword vocabulary for heading detection (forensic note structure).
    _HEADER_KW: /\b(commence|commenced|complete|completed|began|begin|imaging|processing|export|material|materials|reporting|reseal|re-seal|unseal|fastcopy|grading|qa|strategy|objectives?|objectivess|circumstances|exhibits|limitations|disclosure|formats?|methods?|overview|acquisition|analysis|continuity|photographs?|faraday|specific|summary|generated|booking)\b/i,

    /**
     * Heuristic: is this short line a section heading not in the curated library?
     * Deliberately conservative — it requires a section KEYWORD ("…Commence",
     * "Grading Notes", "Generated Material", "Reporting"…) and rejects anything with
     * a digit, colon, question mark or sentence punctuation, so action/value lines
     * ("Commence 00:00", "HS connected to GK", "Mobile > Smart Flow") stay as text.
     */
    _looksLikeHeader(line) {
        const t = line.trim();
        if (t.length < 3 || t.length > 42) return false;
        if (/[:?>\d]/.test(t)) return false;          // labels / questions / flows / times → not headings
        if (/^[-*•]/.test(t)) return false;            // bullets
        if (/[.,;]$/.test(t)) return false;            // ends like a sentence ("Hi,", "Thanks,")
        if (t.split(/\s+/).length > 6) return false;
        return this._HEADER_KW.test(t);
    },

    _parseKeyValue(line) {
        const lineLower = line.toLowerCase();

        // Question + answer FIRST so a long QA question becomes the whole key (not a
        // shorter known-field prefix): "…notes been added to case timeline in LIMA? YES"
        // → key "…LIMA?", value "YES".
        const question = line.match(/^([^?]{5,140}\?)\s+(.+)$/);
        if (question) {
            return { key: question[1].trim(), sep: '', value: question[2].trim() };
        }

        // Standalone question, no answer yet: "If not, what corrective action was taken?"
        const bareQ = line.match(/^(.{5,160}\?)$/);
        if (bareQ) {
            return { key: bareQ[1].trim(), sep: '', value: '' };
        }

        // Match against known fields
        for (const field of Cyfor.notesData.fields) {
            const fieldLower = field.toLowerCase();
            if (!lineLower.startsWith(fieldLower)) continue;

            const afterField = line.substring(field.length);

            // Separator pattern
            const sepMatch = afterField.match(/^(\s*[:?\-–—]\s*)([\s\S]*)/);
            if (sepMatch) {
                return {
                    key: line.substring(0, field.length),
                    sep: field.endsWith('?') ? '' : ':',
                    value: sepMatch[2].trim()
                };
            }

            // Field ends with ? — rest is value
            if (field.endsWith('?')) {
                return { key: line.substring(0, field.length), sep: '', value: afterField.trim() };
            }

            // Field followed by a space then a value. Long fields take any value;
            // short fields (Make, Notes, Status…) only when the value is clearly a
            // value (time / number / yes-no / short token) so prose like
            // "Make sure the device is off" isn't mistaken for "Make: ...".
            if (/^\s+\S/.test(afterField)) {
                const v = afterField.trim();
                if (field.length > 12 || /^(\d{1,2}:\d{2}|\d[\d.,:/]*|yes|no|n\/?a|partial|pass(?:ed)?|fail(?:ed)?|completed?)\b/i.test(v)) {
                    return { key: line.substring(0, field.length), sep: ':', value: v };
                }
            }

            // Exact match (boolean flag or empty value)
            if (afterField.trim() === '') {
                return { key: line.substring(0, field.length), sep: ':', value: '' };
            }
        }

        // Generic "Key: Value" (colon with a value).
        const generic = line.match(/^([^:?]{2,60}):\s+(.+)$/);
        if (generic && generic[1].split(/\s+/).length <= 9) {
            return { key: generic[1].trim(), sep: ':', value: generic[2].trim() };
        }

        // Empty-value label: "Circumstances:", "Exhibit Reference:", "Police Force:",
        // "Case Type (eg Prosecution/Defence/Family/Corporate):".
        const label = line.match(/^([^:?]{2,64}):\s*$/);
        if (label && label[1].split(/\s+/).length <= 10) {
            return { key: label[1].trim(), sep: ':', value: '' };
        }

        // Dash-separated "Label - value" (e.g. "Commenced - 00:00", "Subject - Return",
        // "Case reference - YES/NO"). Guarded against hyphenated prose / signatures:
        // the separator must be a dash FOLLOWED by a space, the key must be short and
        // free of commas, and a bare lead dash (a bullet) is excluded.
        const dash = line.match(/^([^-–—][^-–—]{0,39}?)\s*[-–—]\s+(.+)$/);
        if (dash) {
            const key = dash[1].trim();
            if (key && key.indexOf(',') === -1 && key.split(/\s+/).length <= 6 && !/[.?!]$/.test(key)) {
                return { key, sep: ':', value: dash[2].trim() };
            }
        }

        // Trailing answer with no separator: a statement ending in a YES/NO-style
        // token (the source sometimes drops the "?"), e.g. "…Strategy been provided YES/NO".
        const ans = line.match(/^(.{3,150}?)\s+((?:yes|no|n\/?a|partial)(?:\s*\/\s*(?:yes|no|n\/?a|na))*)$/i);
        if (ans && !/[.,;:?]$/.test(ans[1])) {
            return { key: ans[1].trim(), sep: '', value: ans[2].trim() };
        }

        return null;
    },

    // Highlight status tokens (YES/NO/N/A/PASS/FAIL/PENDING/PARTIAL), case-insensitive,
    // preserving the original casing. Single pass so it never re-scans inserted markup.
    // `text` is already HTML-escaped, so there are no real tags to worry about.
    _colorize(text) {
        return text.replace(/\b(YES|NO|N\/?A|PASS(?:ED)?|FAIL(?:ED)?|PENDING|PARTIAL)\b/gi, (m) => {
            const u = m.toUpperCase().replace('/', '');
            let cls = 'cyfor-val-pending';
            if (u === 'YES' || u.indexOf('PASS') === 0) cls = 'cyfor-val-yes';
            else if (u === 'NO' || u.indexOf('FAIL') === 0) cls = 'cyfor-val-no';
            else if (u === 'NA') cls = 'cyfor-val-na';
            return `<span class="${cls}">${m}</span>`;
        });
    },

    init() {
        Cyfor.config.onChange.enableFormatNotes.push(() => this.handleState());
        this.handleState();
        Cyfor.cleanup.register(() => this._stopScanning());
    }
};