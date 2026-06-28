// ==================================================
// CYFOR Nucleus Enhancer — Right-Click Date/Time
// Right-click on date or time inputs to fill with
// the current date/time value.
// ==================================================

Cyfor.datetime = {
    /**
     * Initialise the right-click date/time feature.
     * Attaches a single contextmenu listener to the document.
     */
    init() {
        const handler = (e) => {
            if (Cyfor.utils.isContextInvalid()) return;
            if (!Cyfor.config.enableDate) return;

            // Resolve the field the cursor is over. Use composedPath()[0] — the REAL
            // element inside open shadow DOM — not e.target: on a record page Lightning
            // retargets e.target to the outer flexipage host, so e.target.closest() finds
            // no field (why inline-edit right-clicks did nothing). The coordinate/geometry
            // fallbacks below cover odd cases (zoom, re-render detaching the target).
            const x = e.clientX, y = e.clientY;
            const inField = (n) => n && typeof n.closest === 'function' && n.isConnected !== false && n.closest('.slds-form-element');
            const path = (e.composedPath && e.composedPath()) || [];
            let el = path[0] || e.target;
            if (!inField(el)) {
                const atPoint = (x || y) ? document.elementFromPoint(x, y) : null;
                if (inField(atPoint)) el = atPoint;
                else el = ((x || y) && this._fieldAtPoint(x, y)) || atPoint || el;
            }
            // Zoom-proof last resort: the field captured on the right-button press,
            // before any re-render detached it (the coordinate-based fallbacks above
            // are unreliable at non-100% zoom).
            if (!inField(el) && this._downField && (Date.now() - this._downField.at) < 1500) {
                el = (this._downField.host && this._downField.host.isConnected && this._downField.host)
                    || this._fieldByLabel(this._downField.label) || el;
            }
            if (!el || typeof el.closest !== 'function') return;
            Cyfor.log('rightclick', 'field resolved', { tag: el.tagName, cls: el.className, usedDownField: !inField(e.target) });

            // Find the Lightning date/time picker around the click. Forgiving of
            // landing on the calendar icon, the field padding, or a wrapper rather
            // than the <input> itself — the old code required an exact <input> hit,
            // which is why it felt unreliable and "worked on the second try".
            const picker = el.closest('lightning-timepicker, lightning-datepicker');
            if (!picker) {
                if (this._maybeCycleStatus(e, el)) return;
                if (this._maybeFillExhibitType(e, el)) return;
                if (this._maybeFillForensicCase(e, el)) return;
                if (this._maybeFillEncryptionPassword(e, el)) return;
                this._maybeFillUserLookup(e, el);
                return;
            }

            const input = (el.tagName === 'INPUT') ? el : picker.querySelector('input');
            if (!input || input.disabled || input.readOnly) return;

            // We're handling this click — suppress the native context menu.
            e.preventDefault();

            const now = new Date();
            const isTime = picker.tagName.toLowerCase() === 'lightning-timepicker';

            if (isTime) {
                const value = now.toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                Cyfor.utils.setFieldValue(input, value);
                Cyfor.utils.flashElement(input);
                Cyfor.toast.success(`Time set to ${value}`, 1500);
                Cyfor.log('rightclick', 'time set', { value });
            } else {
                const value = now.toLocaleDateString('en-GB');
                Cyfor.utils.setFieldValue(input, value);
                Cyfor.utils.flashElement(input);
                Cyfor.toast.success(`Date set to ${value}`, 1500);
                Cyfor.log('rightclick', 'date set', { value });
            }
        };

        // Capture the field on right-button press, BEFORE Salesforce can re-render
        // and detach the target. e.target is an accurate, zoom-independent hit test,
        // so the context menu can still resolve the field even at non-100% zoom
        // (where elementFromPoint / geometry are unreliable).
        Cyfor.cleanup.addEventListener(document, 'mousedown', (e) => {
            if (e.button !== 2) return;
            const t = (e.composedPath && e.composedPath()[0]) || e.target; // real target, not the retargeted shadow host
            const host = (t && typeof t.closest === 'function') ? t.closest('.slds-form-element') : null;
            if (!host) { this._downField = null; return; }
            const l = host.querySelector('label, .slds-form-element__label');
            this._downField = { host: host, label: l ? (l.textContent || '').trim().toLowerCase() : '', at: Date.now() };
        }, true);

        // Capture phase: run BEFORE the event reaches the field, so the first
        // right-click on a lookup (which re-renders/refocuses on interaction) is
        // still caught — otherwise it slipped through to the native menu the first
        // time and only worked on the second.
        Cyfor.cleanup.addEventListener(document, 'contextmenu', handler, true);
    },

    // Status picklist cycle: right-click steps through the working states.
    // Awaiting Start → In Progress → Completed → In Progress → Completed → …
    // Keys are lowercase current values; values are the EXACT option labels.
    _STATUS_CYCLE: {
        'awaiting start': 'In Progress',
        'in progress':    'Completed',
        'completed':      'In Progress'
    },

    // Generated Material has its OWN QA workflow on right-click. Any non-QA value (blank,
    // draft, in progress…) starts it at "Awaiting QA"; from there it steps QA → return →
    // returned, then stops (null = leave the native menu). Labels must match the picklist
    // options exactly — adjust here if your org words them differently.
    _gmNextStatus(current) {
        switch ((current || '').toLowerCase().trim()) {
            case 'awaiting qa':              return 'QA Complete';
            case 'qa complete':              return 'Complete Awaiting Return';
            case 'complete awaiting return': return 'Returned';
            case 'returned':                 return null;   // terminal
            default:                         return 'Awaiting QA';
        }
    },

    // True if the form/modal around `el` is a Generated Material record (so the QA cycle
    // applies), vs an exhibit/process (which uses _STATUS_CYCLE). Detected by a heading
    // or a label unique to Generated Material — it carries an "Encryption Password" field.
    _isGeneratedMaterialForm(el) {
        const scope = (el.closest && el.closest('.slds-modal, [role="dialog"], .forceRecordLayout, .slds-form, form')) || document;
        const title = scope.querySelector('.slds-modal__title, .slds-page-header__title, h1, h2');
        if (title && /generated material/i.test(title.textContent || '')) return true;
        const labels = scope.querySelectorAll('label, .slds-form-element__label, .test-id__field-label');
        for (let i = 0; i < labels.length; i++) {
            const t = (labels[i].textContent || '').toLowerCase();
            if (t.indexOf('encryption password') !== -1 || t.indexOf('generated material') !== -1) return true;
        }
        return false;
    },

    /**
     * Right-click on a "Status" picklist cycles its value (see _STATUS_CYCLE) by
     * opening Salesforce's own dropdown and clicking the target option — the
     * exact clicks a user would make, so all framework events fire naturally.
     * Returns true when it handled the event.
     */
    _maybeCycleStatus(e, el) {
        const host = el.closest('lightning-combobox');
        if (!host) return false;

        const labelEl = host.querySelector('label');
        if (!/status/i.test((labelEl && labelEl.textContent) || '')) return false;

        const trigger = host.querySelector('button[role="combobox"], input[role="combobox"]');
        if (!trigger || trigger.disabled) return false;

        const current = (trigger.tagName === 'INPUT' ? trigger.value : trigger.textContent || '').trim();
        const target = this._isGeneratedMaterialForm(host)
            ? this._gmNextStatus(current)
            : this._STATUS_CYCLE[current.toLowerCase()];
        if (!target) return false; // terminal / unrecognised: leave the native menu alone

        e.preventDefault();
        trigger.click(); // open the picklist dropdown

        let attempts = 0;
        const tryPick = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8);
            const pick = options.find((o) =>
                ((o.textContent || '').trim().toLowerCase() === target.toLowerCase()));
            if (pick) {
                pick.click();
                Cyfor.utils.flashElement(trigger);
                Cyfor.toast.success(`Status set to ${target}`, 1500);
                Cyfor.log('rightclick', 'status set', { value: target });
                return;
            }
            attempts++;
            if (attempts < 14) Cyfor.cleanup.setTimeout(tryPick, 150); // ~2s total
            // else: dropdown stays open for a manual pick.
        };
        Cyfor.cleanup.setTimeout(tryPick, 120);
        return true;
    },

    // Field labels eligible for right-click self-fill (user lookups whose first
    // left-click suggestion is the current user). Lowercase substrings.
    _USER_LOOKUP_LABELS: ['completed by', 'sealed by', 'conducted by', 'assigned staff'],

    /**
     * Right-click on a "Completed By" / "Sealed By" user-lookup: open Salesforce's
     * own suggestion dropdown (same as a left-click) and auto-select the current
     * user — the entry a manual left-click would show first. If the suggestions
     * don't appear in time, the dropdown is simply left open for a manual pick.
     */
    _maybeFillUserLookup(e, el) {
        if (el.tagName !== 'INPUT' || el.disabled || el.readOnly) return;

        // Lookup inputs are comboboxes; bail early for ordinary text inputs.
        if ((el.getAttribute('role') || '').toLowerCase() !== 'combobox') return;

        const host = el.closest('lightning-grouped-combobox, lightning-lookup, .slds-form-element');
        if (!host) return;

        const labelEl = host.querySelector('label');
        const label = ((labelEl && labelEl.textContent) || '').trim().toLowerCase();
        if (!this._USER_LOOKUP_LABELS.some((l) => label.indexOf(l) !== -1)) return;

        e.preventDefault();

        // Open the native suggestion dropdown exactly like a left-click would.
        el.focus();
        el.click();

        const userName = (Cyfor.config.sfUser && Cyfor.config.sfUser.fullName) || null;
        let attempts = 0;

        const tryPick = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8)
                .filter((o) => o.getAttribute('aria-disabled') !== 'true');

            if (options.length) {
                // Prefer the option matching the signed-in user; otherwise take the
                // first suggestion (which is the user for these fields anyway).
                // Skip "New User…" creator entries.
                const real = options.filter((o) => !/^\s*new\b/i.test(o.textContent || ''));
                let pick = userName
                    ? real.find((o) => (o.textContent || '').indexOf(userName) !== -1)
                    : null;
                if (!pick) pick = real[0];
                if (pick) {
                    // textContent glues the option's sub-spans together with no
                    // separator ("Adam JonesDigital Forensic Examiner"), so prefer
                    // the matched user name, then the option's title attribute.
                    const raw = (pick.textContent || '').trim();
                    const pickedText = (userName && raw.indexOf(userName) !== -1)
                        ? userName
                        : ((pick.getAttribute('title') || '').trim() || raw);
                    pick.click();
                    Cyfor.utils.flashElement(el);
                    Cyfor.toast.success(`Set to ${pickedText || 'you'}`, 1500);
                    Cyfor.log('rightclick', 'user lookup set', { value: pickedText || 'you' });
                    return;
                }
            }

            attempts++;
            if (attempts < 14) Cyfor.cleanup.setTimeout(tryPick, 150); // ~2s total
            // else: leave the dropdown open — one manual click finishes the job.
        };

        Cyfor.cleanup.setTimeout(tryPick, 120); // give the listbox a beat to render
    },

    // ── Encryption password (Generated Material) ─────────────────────────────────
    // Right-click an "Encryption Password" field: pull the password out of the case's
    // "Case Background" field (where examiners note the VHDX / BitLocker password) and
    // drop it in. Leaves the native menu untouched if there's nothing usable to insert.
    _maybeFillEncryptionPassword(e, el) {
        const host = el.closest && el.closest('.slds-form-element');
        if (!host) return false;
        const l = host.querySelector('label, .slds-form-element__label');
        if (((l && l.textContent) || '').trim().toLowerCase().indexOf('encryption password') === -1) return false;

        const self  = this;
        const input = this._editableInput(host);
        if (input) {                       // create form, or inline-edit already on → fill now
            e.preventDefault();
            this._fillEncryptionFromCase(input, host);
            return true;
        }

        // View mode on an existing record: click the field's inline-edit pencil, then fill
        // once the edit input renders — so a right-click behaves the same as on a new GM.
        // No pencil = the field is read-only for this user → leave the native menu.
        const pencil = host.querySelector('button[title^="Edit" i], .test-id__inline-edit-trigger');
        if (!pencil) return false;
        e.preventDefault();
        try { pencil.click(); } catch (err) { /* ignore */ }
        let tries = 0;
        const waitForInput = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const h   = self._encryptionPasswordHost() || host;   // the field can re-render on edit
            const inp = self._editableInput(h);
            if (inp) { self._fillEncryptionFromCase(inp, h); return; }
            if (++tries < 25) Cyfor.cleanup.setTimeout(waitForInput, 120); // ~3s for the input to render
        };
        Cyfor.cleanup.setTimeout(waitForInput, 150);
        return true;
    },

    // The editable input for a field — SHADOW-PIERCING. On a record page (and in
    // inline-edit) the real <input> lives inside lightning-input's shadow root, which a
    // plain host.querySelector can't reach — that's why this worked on the New form but
    // not when editing an existing record.
    _editableInput(host) {
        if (!host) return null;
        const direct = host.querySelector('input, textarea');
        if (direct && !direct.disabled && !direct.readOnly && direct.type !== 'hidden') return direct;
        const deep = Cyfor.utils.querySelectorAllDeep('input, textarea', host, 8);
        for (let i = 0; i < deep.length; i++) {
            if (!deep[i].disabled && !deep[i].readOnly && deep[i].type !== 'hidden') return deep[i];
        }
        return null;
    },

    // The Encryption Password field group, found by label across shadow DOM (it can
    // re-render when it flips into inline-edit, so we re-find rather than hold a ref).
    _encryptionPasswordHost() {
        const labels = Cyfor.utils.querySelectorAllDeep('label, .slds-form-element__label', document.body, 14);
        for (let i = 0; i < labels.length; i++) {
            if (((labels[i].textContent || '').trim().toLowerCase().indexOf('encryption password')) !== -1) {
                return labels[i].closest('.slds-form-element') || labels[i].parentElement;
            }
        }
        return null;
    },

    // Fetch the (parent) case's Case Background and drop the extracted password into the
    // input. caseId from context (New overlay / case page), else traverse the current
    // record (an existing GM) up its Forensic Case lookup in the background.
    _fillEncryptionFromCase(input, host) {
        const self   = this;
        const caseId = this._currentCaseId(host);
        const rec    = caseId ? null : this._currentRecordRef();
        if (!caseId && !rec) {
            const domPw = this._extractPassword(this._findCaseBackground());
            if (domPw) this._setEncryptionPassword(input, host, domPw);
            else Cyfor.toast.info('Couldn’t work out which case this material belongs to', 1800);
            return;
        }
        const msg = { action: 'caseBackground.fetch', caseId: caseId || '' };
        if (rec) { msg.recordId = rec.id; msg.object = rec.object; }
        chrome.runtime.sendMessage(msg, function (r) {
            if (Cyfor.utils.isContextInvalid()) return;
            let pw = (r && r.ok) ? self._extractPassword(r.text || '') : '';
            if (!pw) pw = self._extractPassword(self._findCaseBackground());
            Cyfor.log('rightclick', 'encryption password', { caseId, rec, found: !!pw });
            if (pw) self._setEncryptionPassword(input, host, pw);
            else Cyfor.toast.info('No password found in the case background', 2000);
        });
    },

    // The current record from the URL's object-named form (/lightning/r/<Object>/<id>) —
    // e.g. a Generated Material being edited — so the background can traverse up to its
    // parent case when no case id is directly in context. Custom objects only (__c).
    _currentRecordRef() {
        const m = (location.href || '').match(/\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})(?:\/|$|\?)/);
        return (m && /__c$/i.test(m[1])) ? { object: m[1], id: m[2] } : null;
    },

    _setEncryptionPassword(input, host, pw) {
        // Re-find the input if a re-render detached it while the query was in flight
        // (shadow-piercing — the input is inside lightning-input's shadow root).
        if (!input || !input.isConnected) input = (host && host.isConnected) ? this._editableInput(host) : null;
        if (!input) return;
        Cyfor.utils.setFieldValue(input, pw);
        Cyfor.utils.flashElement(input);
        Cyfor.toast.success('Encryption password set from case background', 1800);
    },

    // The Forensic Case id in context: the case's own record page URL (a New modal opened
    // from the case keeps the case URL), else the Forensic Case lookup on the form itself
    // (legacy data-recordid special-link or a /lightning/r/ link). A wrong id simply
    // returns no background from the query, so we don't need to validate the object here.
    _currentCaseId(host) {
        // Decode first: a "New" overlay carries the parent case in the URL-ENCODED
        // backgroundContext param (…%2Flightning%2Fr%2FForensic_Case__c%2F<id>…), not the
        // path — a raw match misses it. Prefer the explicitly-named case, then any record.
        let url = location.href || '';
        try { url = decodeURIComponent(url); } catch (e) { /* keep raw on malformed escapes */ }
        const m = url.match(/\/lightning\/r\/Forensic_Case__c\/([a-zA-Z0-9]{15,18})/)
               || url.match(/\/lightning\/r\/([a-zA-Z0-9]{15,18})(?:\/|$|\?)/);
        if (m && m[1]) return m[1];
        const scope = (host && host.closest('.slds-modal, [role="dialog"], form')) || document;
        const groups = scope.querySelectorAll('.slds-form-element');
        for (let i = 0; i < groups.length; i++) {
            const lab = ((groups[i].querySelector('label, .slds-form-element__label') || {}).textContent || '').trim().toLowerCase();
            if (lab.indexOf('case') === -1 || lab.indexOf('case type') !== -1 || lab.indexOf('record type') !== -1) continue;
            const link = groups[i].querySelector('[data-recordid], a[href*="/lightning/r/"]');
            if (!link) continue;
            const rid = link.getAttribute('data-recordid');
            if (rid && /^[a-zA-Z0-9]{15,18}$/.test(rid)) return rid;
            const hm = (link.getAttribute('href') || '').match(/\/lightning\/r\/(?:[^/]+\/)?([a-zA-Z0-9]{15,18})/);
            if (hm && hm[1]) return hm[1];
        }
        return null;
    },

    // Read the case's "Case Background" text from the page — the case record page stays
    // in the DOM even behind a Generated Material modal, so a document-wide search finds
    // it. Find the LABEL first (shadow-piercing), then read the value beside it. The value
    // must be read with _deepText: a rich-text field keeps its rendered value inside
    // lightning-formatted-rich-text's shadow root, where plain .textContent reads empty.
    _findCaseBackground() {
        const labels = Cyfor.utils.querySelectorAllDeep(
            '.slds-form-element__label, .test-id__field-label, label', document.body, 14);
        for (let i = 0; i < labels.length; i++) {
            if (((labels[i].textContent || '').trim().toLowerCase().indexOf('case background')) === -1) continue;
            const group = labels[i].closest('.slds-form-element, records-record-layout-item') || labels[i].parentElement;
            if (!group) continue;
            const inp = group.querySelector('textarea, input');
            if (inp && (inp.value || '').trim()) return inp.value;
            const ctrl = group.querySelector('.slds-form-element__control') || group;
            const txt = this._deepText(ctrl);
            if (txt && txt.trim()) return txt;
        }
        return '';
    },

    // textContent that also reaches into shadow roots — lightning-formatted-rich-text
    // renders its value in its shadow root, invisible to a plain .textContent read.
    _deepText(root) {
        if (!root) return '';
        const direct = (root.textContent || '');
        if (direct.trim()) return direct;
        const nodes = Cyfor.utils.querySelectorAllDeep(
            'p, span, div, li, lightning-formatted-text, lightning-formatted-rich-text', root, 8);
        return nodes.map((n) => n.textContent || '').join('\n');
    },

    // Pull a password out of free-text case background. Handles "Password: X",
    // "Password - X", "Password=X", "Pwd: X" etc. (however people separate it), trims
    // trailing sentence punctuation, and falls back to the whole field when it's just a
    // lone token (some examiners note only the password, with no label).
    _extractPassword(text) {
        if (!text) return '';
        const lines = String(text)
            .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/[\u00a0\u202f]/g, ' ')
            .split(/\r?\n/);
        // Never return the label word itself, or obvious "no value" words.
        const tokenOf = (s) => {
            const v = (s || '').trim().split(/\s+/)[0].replace(/[.,;:]+$/, '');
            return /^(?:passwords?|passcodes?|pass|pwd|unknown|none|n\/?a|tbc|tbd|pending|required|protected)$/i.test(v) ? '' : v;
        };
        const KEYWORD = /^[\s>\-*]*(?:passwords?|passcodes?|pass\s*word|pwd)\b/i;
        for (let i = 0; i < lines.length; i++) {
            if (!KEYWORD.test(lines[i])) continue;
            // Value on the SAME line, after an optional connector/separator.
            const m = lines[i].match(/^[\s>\-*]*(?:passwords?|passcodes?|pass\s*word|pwd)\b\s*(?:is\b\s*)?[:\-=]?\s*(.+)$/i);
            if (m && m[1]) { const v = tokenOf(m[1]); if (v) return v; }
            // Otherwise the value is on the NEXT non-empty line ("Password:\n<value>").
            for (let j = i + 1; j < lines.length; j++) {
                if (!lines[j].trim()) continue;
                const v = tokenOf(lines[j]);
                if (v) return v;
                break;
            }
        }
        // No "Password" label anywhere — if the whole field is a lone token use it (but
        // never the literal word "password").
        const lone = String(text).replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
        if (lone && !/\s/.test(lone) && lone.length >= 4 && lone.length <= 64
            && !/^(?:passwords?|passcodes?|pass|pwd)$/i.test(lone)) return lone;
        return '';
    },

    // Right-click in an "Exhibit Type" picklist: read the exhibit name/reference on
    // the SAME form and, if a token carries a known marker (e.g. "LM/01-SIM",
    // "…-SD"), auto-select the matching type WITHOUT the user typing anything.
    // To add a type: `marker` = the bit in the name, `search` = what to type so the
    // option appears, `type` = the option label to select. SD is treated as memory.
    _EXHIBIT_TYPE_MARKERS: [
        { marker: 'sim', search: 'SIM',  type: 'SIM Card' },
        { marker: 'mem', search: 'Mem',  type: 'Memory Card' },
        { marker: 'sd',  search: 'Mem',  type: 'Memory Card' },  // SD card = memory card
        { marker: 'usb', search: 'USB',  type: 'USB Drive' },
        { marker: 'hdd', search: 'Hard', type: 'Hard Drive' },
        // Generated Material: an MG22A / MG22B anywhere in the record name → that exhibit
        // type. `contains` (not token-start) so it matches however the name is written.
        // `search` surfaces both options; `type` is the EXACT option label to click.
        { marker: 'mg22a', search: 'MG22', type: 'MG22a SFR', contains: true },
        { marker: 'mg22b', search: 'MG22', type: 'MG22B SFR', contains: true }
    ],

    // True if any "/-_ space"-delimited token of the name starts with the marker,
    // so "LM/01-SIM", "…-SIM1" and "…-SD" match but a random substring won't.
    _nameHasMarker(name, marker) {
        return String(name || '').toLowerCase().split(/[^a-z0-9]+/)
            .some((t) => t.indexOf(marker) === 0);
    },

    // Plain substring match — for markers (MG22A/MG22B) that should hit wherever they
    // appear in the name, not only at a token boundary.
    _nameContains(name, marker) {
        return String(name || '').toLowerCase().indexOf(marker) !== -1;
    },

    // Find the exhibit name/reference field on the same form and return its value.
    // Priority order, and explicitly NOT the Type / Parent Exhibit / Seal Reference
    // / Forensic Case fields (which would otherwise match "exhibit"/"reference").
    _findExhibitName(typeField) {
        const scope = typeField.closest('.slds-modal, [role="dialog"], form, .slds-form') || document;
        const groups = Array.from(scope.querySelectorAll('.slds-form-element'));
        const labelOf = (g) => {
            const l = g.querySelector('label, .slds-form-element__label');
            return ((l && l.textContent) || '').trim().toLowerCase();
        };
        const wanted = ['exhibit name', 'exhibit reference', 'name', 'reference'];
        for (const w of wanted) {
            for (const g of groups) {
                const label = labelOf(g);
                if (!label || /type|parent|seal|forensic/.test(label)) continue;
                if (label.indexOf(w) !== -1) {
                    const input = g.querySelector('input, textarea');
                    if (input && input.value) return String(input.value);
                }
            }
        }
        return '';
    },

    // Type into a Lightning combobox the way the framework notices (native value
    // setter + input/keyup), so its suggestion list filters as if the user typed.
    _typeInto(el, text) {
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(el, text); else el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: text.slice(-1) || 'a' }));
    },

    // The Salesforce field whose box contains the cursor — purely geometric, so
    // it still finds the field when an overlay covers the input or the original
    // target was detached by a re-render. Returns the innermost matching field.
    _fieldAtPoint(x, y) {
        const groups = document.querySelectorAll('.slds-form-element');
        let best = null, bestArea = Infinity;
        for (const g of groups) {
            const r = g.getBoundingClientRect();
            if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                const area = r.width * r.height;
                if (area < bestArea) { best = g; bestArea = area; } // smallest = innermost
            }
        }
        return best;
    },

    // The .slds-form-element whose label matches — used to re-find a field that was
    // captured on mousedown after a re-render replaced it (zoom-proof, no coords).
    _fieldByLabel(lbl) {
        if (!lbl) return null;
        const groups = document.querySelectorAll('.slds-form-element');
        for (const g of groups) {
            const l = g.querySelector('label, .slds-form-element__label');
            if (l && (l.textContent || '').trim().toLowerCase() === lbl) return g;
        }
        return null;
    },

    // Find the combobox <input> for the field the right-click landed in — from a
    // wrapper, icon, padding or the input itself — so it works WITHOUT focusing
    // first. Anchored on the .slds-form-element wrapper, which holds BOTH the
    // label and the input (narrower combobox containers exclude the label).
    // Returns null if this isn't a (relevant) combobox field.
    _comboFromClick(el) {
        const host = el.closest('.slds-form-element');
        if (!host) return null;
        const labelEl = host.querySelector('label, .slds-form-element__label');
        const label = ((labelEl && labelEl.textContent) || '').trim().toLowerCase();
        if (!label) return null;
        return { host, label }; // input may not exist yet — fetch/activate it later
    },

    _comboInput(host) {
        return host.querySelector('input[role="combobox"]') || host.querySelector('input') || null;
    },

    // Click the field's trigger to activate/expand the lookup — renders the
    // <input> if the field had collapsed (which happens once another field is
    // edited and the form re-renders) and opens its dropdown, like a left-click.
    _openCombobox(host) {
        const trigger = host.querySelector('input[role="combobox"]')
            || host.querySelector('input')
            || host.querySelector('button')
            || host.querySelector('[role="combobox"]')
            || host.querySelector('.slds-combobox__input, .slds-combobox__form-element');
        if (trigger) {
            try { trigger.focus(); } catch (e) { /* ignore */ }
            try { trigger.click(); } catch (e) { /* ignore */ }
        }
    },

    _maybeFillExhibitType(e, el) {
        const f = this._comboFromClick(el);
        if (!f) return false;
        // Must be the exhibit-type picklist (and never a "Record/Case Type" one).
        const isType = f.label.indexOf('exhibit type') !== -1
            || (f.label.indexOf('type') !== -1 && f.label.indexOf('record type') === -1 && f.label.indexOf('case type') === -1);
        if (!isType) return false;

        const name = this._findExhibitName(f.host);
        if (!name) return false;
        const hit = this._EXHIBIT_TYPE_MARKERS.find((m) =>
            m.contains ? this._nameContains(name, m.marker) : this._nameHasMarker(name, m.marker));
        Cyfor.log('rightclick', 'exhibit-type marker', { name, marker: hit && hit.marker, type: hit && hit.type });
        if (!hit) return false;

        e.preventDefault();
        const host = f.host, want = hit.type.toLowerCase();

        const tryPick = () => {
            // Results render in an overlay OUTSIDE the field — search the field
            // first, then the whole document, accepting only visible options.
            let options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8);
            if (!options.length) options = Cyfor.utils.querySelectorAllDeep('[role="option"]', document.body, 10);
            options = options.filter((o) => o.getAttribute('aria-disabled') !== 'true' && o.offsetParent !== null);
            const pick = options.find((o) => (o.textContent || '').trim().toLowerCase() === want)
                || options.find((o) => (o.textContent || '').trim().toLowerCase().indexOf(want) !== -1);
            if (pick) {
                pick.click();
                Cyfor.utils.flashElement(this._comboInput(host) || host);
                Cyfor.toast.success('Exhibit type set to ' + hit.type, 1500);
                Cyfor.log('rightclick', 'exhibit type set', { type: hit.type });
                return true;
            }
            return false;
        };

        // The lookup only searches once OPEN, so type the text, open it, then pick.
        const doType = (input) => {
            input.focus();
            this._typeInto(input, hit.search);
            Cyfor.cleanup.setTimeout(() => {
                if (Cyfor.utils.isContextInvalid()) return;
                try { input.click(); } catch (e) { /* ignore */ } // open → searches typed text
                let a = 0;
                const poll = () => {
                    if (Cyfor.utils.isContextInvalid()) return;
                    if (tryPick()) return;
                    a++;
                    if (a < 24) Cyfor.cleanup.setTimeout(poll, 150);
                };
                Cyfor.cleanup.setTimeout(poll, 200);
            }, 120);
        };

        const existing = this._comboInput(host);
        if (existing) { doType(existing); return true; }

        // Input not in the DOM yet (the field collapsed after another field was
        // edited) — activate it to render the input, then type.
        this._openCombobox(host);
        let a = 0;
        const wait = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const input = this._comboInput(host);
            if (input) { doType(input); return; }
            if (a === 4) this._openCombobox(host); // nudge again if still collapsed
            a++;
            if (a < 16) Cyfor.cleanup.setTimeout(wait, 150);
        };
        Cyfor.cleanup.setTimeout(wait, 150);
        return true;
    },

    // Right-click a "Forensic Case" lookup to insert the first (top) suggestion.
    // Salesforce shows recent records on activation, so no typing is needed.
    _maybeFillForensicCase(e, el) {
        const f = this._comboFromClick(el);
        if (!f || f.label.indexOf('forensic case') === -1) return false;

        e.preventDefault();
        const host = f.host;
        this._openCombobox(host); // activate + open recents (renders the input if collapsed)

        let attempts = 0;
        const tryPick = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8)
                .filter((o) => o.getAttribute('aria-disabled') !== 'true');
            // Skip "New …" / "Add …" creator entries; take the first real one.
            const real = options.filter((o) => !/^\s*(new|add)\b/i.test(o.textContent || ''));
            const pick = real[0];
            if (pick) {
                // The option glues the reference to a date ("DP-420/2608/06/2026,…").
                // Prefer the primary text span; else strip a trailing date-time.
                const primary = pick.querySelector('.slds-listbox__option-text, [class*="option-text"]');
                let label = (primary ? (primary.getAttribute('title') || primary.textContent || '') : '').trim();
                if (!label) {
                    label = (pick.getAttribute('title') || pick.textContent || '').trim()
                        .replace(/\s*\d{1,2}\/\d{1,2}\/\d{4}.*$/, '').trim();
                }
                pick.click();
                Cyfor.utils.flashElement(this._comboInput(host) || host);
                Cyfor.toast.success('Forensic case set to ' + (label || 'top match'), 1500);
                Cyfor.log('rightclick', 'forensic case set', { value: label || 'top match' });
                return;
            }
            if (attempts === 5) this._openCombobox(host); // nudge open again if needed
            attempts++;
            if (attempts < 18) Cyfor.cleanup.setTimeout(tryPick, 150);
            // else: leave the dropdown open for a manual pick.
        };
        Cyfor.cleanup.setTimeout(tryPick, 180);
        return true;
    }
};