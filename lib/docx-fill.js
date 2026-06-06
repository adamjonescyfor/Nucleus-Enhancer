// ████████████████████████████████████████████████████████████████████████████
// MG22A / MG22B REPORT GENERATION — OWNED BY MITUL (work in progress)
// Generic .docx fill engine used only by the MG22 feature today (hidden behind
// the MG22_ENABLED flag in content/case-report.js). Hidden, NOT deleted — left
// intact for Mitul. Related: report/mg-extract.js, background/sf-report-templates.js.
// ████████████████████████████████████████████████████████████████████████████
// ==================================================
// CYFOR Nucleus Enhancer — .docx fill engine
// Fills {{placeholders}} in a Word .docx template, preserving formatting.
//
// Word frequently splits a placeholder like {{make}} across several runs
// (<w:r><w:t>{{</w:t></w:r><w:r><w:t>ma</w:t></w:r>...). To handle that we
// work per paragraph: join the text of its <w:t> nodes, replace {{tags}} in
// the joined text, then write the result back into the first <w:t> and blank
// the rest. Paragraphs with no placeholder are left untouched, so only the
// value cells get their runs merged (fine for form fields).
//
// Uses fflate (MIT) for zip read/write. v1 = single-value replacement only
// (no loops); multi-row looping is a later phase.
//
// Browser:  load lib/fflate.min.js first, then this. Use self.DocxFill.fill().
// Node:     set global.fflate = require('./lib/fflate.min.js') first.
// ==================================================

(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof self !== 'undefined') self.DocxFill = api;
    else if (typeof window !== 'undefined') window.DocxFill = api;
})(this, function () {

    function getFflate() {
        if (typeof fflate !== 'undefined') return fflate;
        if (typeof self !== 'undefined' && self.fflate) return self.fflate;
        if (typeof globalThis !== 'undefined' && globalThis.fflate) return globalThis.fflate;
        throw new Error('fflate library not loaded');
    }

    function xmlEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // Replace {{tags}} inside one XML part (document.xml / header / footer),
    // tolerating placeholders split across multiple <w:t> runs.
    function fillXml(xml, data) {
        return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, function (para) {
            // Collect <w:t ...>text</w:t> segments in document order.
            var tRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
            var segs = [];
            var m;
            while ((m = tRe.exec(para)) !== null) {
                segs.push({ open: m[1], text: m[2], close: m[3], index: m.index, length: m[0].length });
            }
            if (!segs.length) return para;

            var joined = segs.map(function (s) { return s.text; }).join('');
            if (joined.indexOf('{{') === -1) return para; // nothing to do

            var replaced = joined.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, function (whole, key) {
                return Object.prototype.hasOwnProperty.call(data, key) ? xmlEscape(data[key]) : '';
            });
            if (replaced === joined) return para;

            // Put the whole replaced string into the first <w:t>; empty the rest.
            // Rewrite from last to first so earlier indices stay valid.
            var out = para;
            for (var i = segs.length - 1; i >= 0; i--) {
                var seg = segs[i];
                var inner = (i === 0) ? replaced : '';
                var newSeg = seg.open + inner + seg.close;
                out = out.slice(0, seg.index) + newSeg + out.slice(seg.index + seg.length);
            }
            return out;
        });
    }

    // Word often splits a {{tag}} or {#loop} marker across runs. Glue the text
    // back together by removing run boundaries that fall *inside* an open
    // "{...}" token, so markers/tags become contiguous in the XML.
    function glueTokens(xml) {
        var prev;
        do {
            prev = xml;
            xml = xml.replace(/(\{[^<}]*)<\/w:t>(?:(?!<\/?w:t)[\s\S])*?<w:t\b[^>]*>/g, '$1');
        } while (xml !== prev);
        return xml;
    }

    // Expand {#name}…{/name} loop regions. data[name] must be an array of
    // objects; the whole region (tables/paragraphs) is repeated per item, each
    // filled with the item's fields merged over the top-level data. The marker
    // paragraphs themselves are removed. Single-level loops only.
    function processLoops(xml, data) {
        var openRe = /\{#\s*([A-Za-z0-9_]+)\s*\}/;
        var guard = 0;
        var m;
        while ((m = openRe.exec(xml)) !== null && guard++ < 50) {
            var name = m[1];
            var openIdx = m.index;
            var closeIdx = xml.indexOf('{/' + name + '}', openIdx);
            if (closeIdx === -1) break;

            var openPStart  = xml.lastIndexOf('<w:p', openIdx);
            var openPClose  = xml.indexOf('</w:p>', openIdx) + 6;
            var closePStart = xml.lastIndexOf('<w:p', closeIdx);
            var closePClose = xml.indexOf('</w:p>', closeIdx) + 6;
            if (openPStart < 0 || closePStart < 0 || openPClose < 6 || closePClose < 6) break;

            var region = xml.slice(openPClose, closePStart);
            var arr = Array.isArray(data[name]) ? data[name] : [];
            var out = '';
            for (var i = 0; i < arr.length; i++) {
                var item = {};
                for (var k in data) item[k] = data[k];
                for (var k2 in arr[i]) item[k2] = arr[i][k2];
                out += fillXml(region, item);
            }
            xml = xml.slice(0, openPStart) + out + xml.slice(closePClose);
        }
        return xml;
    }

    // input: ArrayBuffer | Uint8Array of the .docx; data: { tag: value, loopName: [...] }.
    // Returns a Uint8Array of the filled .docx.
    function fill(input, data) {
        var ff = getFflate();
        var u8 = (input instanceof Uint8Array) ? input : new Uint8Array(input);
        var files = ff.unzipSync(u8);

        if (!files['word/document.xml']) {
            throw new Error('Not a Word .docx (missing word/document.xml)');
        }
        data = data || {};

        // Body + any headers/footers (force/region boilerplate often lives there).
        Object.keys(files).forEach(function (name) {
            if (name === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(name)) {
                var xml = ff.strFromU8(files[name]);
                var out = glueTokens(xml);   // merge split tags/markers
                out = processLoops(out, data); // expand {#loops}
                out = fillXml(out, data);      // replace remaining {{tags}}
                if (out !== xml) files[name] = ff.strToU8(out);
            }
        });

        return ff.zipSync(files, { level: 6 });
    }

    // List the {{tags}} present in a template (handy for validating mappings).
    function listTags(input) {
        var ff = getFflate();
        var u8 = (input instanceof Uint8Array) ? input : new Uint8Array(input);
        var files = ff.unzipSync(u8);
        var found = Object.create(null);
        Object.keys(files).forEach(function (name) {
            if (name === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(name)) {
                var xml = ff.strFromU8(files[name]);
                // Join all <w:t> text so split tags are visible.
                var text = (xml.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || [])
                    .map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('');
                var re = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, mm;
                while ((mm = re.exec(text)) !== null) found[mm[1]] = true;
            }
        });
        return Object.keys(found);
    }

    return { fill: fill, fillXml: fillXml, listTags: listTags };
});
