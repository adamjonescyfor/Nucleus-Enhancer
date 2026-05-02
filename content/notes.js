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
        text = text.replace(/[^\S\n]+/g, ' ');
        text = text.replace(/\n{3,}/g, '\n\n');
        text = text.trim();

        if (!text) return `<div class="cyfor-n-text">${Cyfor.utils.escapeHtml(raw)}</div>`;

        // Step 1: Find break points
        const breakPoints = this._findBreakPoints(text);

        // Add existing newlines as break points (this works beautifully now that we preserved them)
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') breakPoints.add(i);
        }

        // Step 2: Split into lines
        const lines = this._splitAtBreakPoints(text, breakPoints);

        // Step 3: Merge fragments
        const merged = this._mergeFragments(lines);

        // Step 4: Build HTML
        return this._buildHtml(merged, raw);
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
            // Lowercase letter immediately followed by an Uppercase letter (CamelCase gluing, e.g. "successTrace")
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

        for (const line of lines) {
            if (line === '') continue;

            // Handle manual dashed horizontal lines (e.g. "----------------------")
            if (/^[-–—_=*]{5,}$/.test(line)) {
                if (sectionOpen) {
                    html += '</div>';
                    sectionOpen = false;
                }
                html += '<hr class="cyfor-n-divider" />';
                continue;
            }

            // Catch Section Headers from our library
            if (Cyfor.notesData.isKnownHeader(line)) {
                if (sectionOpen) html += '</div>';
                const clean = line.replace(/[*#]/g, '').replace(/^[\s:–\-]+|[\s:–\-]+$/g, '');
                html += `<div class="cyfor-n-section">`;
                html += `<div class="cyfor-n-header">${esc(clean)}</div>`;
                sectionOpen = true;
                continue;
            }

            // Catch Prefix Headings (e.g. "MB3: 27/01/2026 - PRE-IMAGING" or "KW3 - 10:15am")
            if (/^([A-Z0-9]{2,8}\s*[-–:]\s*\d{1,2}:\d{2}(?:am|pm)?|[A-Z0-9]+:\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*[-–]\s*.+)$/i.test(line)) {
                if (sectionOpen) html += '</div>';
                html += `<div class="cyfor-n-section">`;
                html += `<div class="cyfor-n-header">${esc(line)}</div>`;
                sectionOpen = true;
                continue;
            }

            // Open implicit section
            if (!sectionOpen) {
                html += '<div class="cyfor-n-section">';
                sectionOpen = true;
            }

            // Catch Bullet Points (e.g. "- Item 1")
            const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
            if (bulletMatch) {
                html += `<div class="cyfor-n-text" style="padding-left: 10px;">• ${this._colorize(esc(bulletMatch[1]))}</div>`;
                continue;
            }

            // Catch Key: Value
            const kv = this._parseKeyValue(line);
            if (kv) {
                html += '<div class="cyfor-n-row">';
                html += `<span class="cyfor-n-key">${esc(kv.key)}${kv.sep}</span>`;
                if (kv.value) {
                    html += ` <span class="cyfor-n-val">${this._colorize(esc(kv.value))}</span>`;
                }
                html += '</div>';
                continue;
            }

            // Plain text fallback
            html += `<div class="cyfor-n-text">${this._colorize(esc(line))}</div>`;
        }

        if (sectionOpen) html += '</div>';
        return html || `<div class="cyfor-n-text">${esc(raw)}</div>`;
    },

    _parseKeyValue(line) {
        const lineLower = line.toLowerCase();

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

            // Field followed by space then value
            if (/^\s+\S/.test(afterField) && field.length > 12) {
                return { key: line.substring(0, field.length), sep: ':', value: afterField.trim() };
            }
            
            // Exact match (boolean flag or empty value)
            if (afterField.trim() === '') {
                return { key: line.substring(0, field.length), sep: ':', value: '' };
            }
        }

        // Generic "Key: Value" (RESTRICTED TO COLONS TO AVOID MANGLING HYPHENATED SENTENCES)
        const generic = line.match(/^([^:–\-]{2,60})\s*[:]\s+(.+)$/);
        if (generic) {
            const key = generic[1].trim();
            if (key.split(/\s+/).length <= 8) {
                return { key, sep: ':', value: generic[2].trim() };
            }
        }

        // Question pattern: "Some question? VALUE"
        const question = line.match(/^([^?]{5,120}\?)\s+(.+)$/);
        if (question) {
            return { key: question[1].trim(), sep: '', value: question[2].trim() };
        }

        return null;
    },

    _colorize(html) {
        return html
            .replace(/\b(YES)\b/g, '<span class="cyfor-val-yes">YES</span>')
            .replace(/\b(NO)\b/g, '<span class="cyfor-val-no">NO</span>')
            .replace(/\b(N\/A)\b/gi, '<span class="cyfor-val-na">N/A</span>')
            .replace(/\b(PASS(?:ED)?)\b/gi, '<span class="cyfor-val-yes">$1</span>')
            .replace(/\b(FAIL(?:ED)?)\b/gi, '<span class="cyfor-val-no">$1</span>')
            .replace(/\b(PENDING)\b/gi, '<span class="cyfor-val-pending">PENDING</span>');
    },

    init() {
        Cyfor.config.onChange.enableFormatNotes.push(() => this.handleState());
        this.handleState();
        Cyfor.cleanup.register(() => this._stopScanning());
    }
};