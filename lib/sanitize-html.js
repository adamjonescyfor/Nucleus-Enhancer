// ==================================================
// CYFOR Nucleus Enhancer — HTML sanitizer (shared by the manager page and the
// content scripts). Whitelists ONLY the formats Salesforce's rich-text editor
// (Quill) keeps, so template content survives both storage and insertion into
// the Notes field. Keeps images (data:/https:); strips scripts, styles, classes,
// event handlers, Word/mso junk and tables. Parsing is done with DOMParser on a
// DETACHED document, so nothing executes or loads while we clean.
//   window.CyforSanitize.html(dirty)        -> safe HTML string
//   window.CyforSanitize.looksLikeHtml(str) -> is a stored template HTML?
//   window.CyforSanitize.toText(html)       -> plain text (diff / search)
// ==================================================
(function () {
    'use strict';

    // Tags Salesforce's RTF keeps. Deliberately no table/script — Quill strips
    // those anyway, so we drop them up front. <img> IS allowed (Salesforce notes
    // support images), with its src locked down in copyAttrs.
    var ALLOWED = {
        p: 1, br: 1, div: 1, span: 1,
        strong: 1, b: 1, em: 1, i: 1, u: 1, s: 1, strike: 1, sub: 1, sup: 1,
        ul: 1, ol: 1, li: 1, blockquote: 1,
        h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, a: 1, img: 1
    };
    // Whole subtree discarded (not unwrapped) — tables, scripts, Word's <o:p>.
    // <img> is NOT here: Salesforce's notes editor supports images (data:/https:).
    var DROP = {
        script: 1, style: 1, table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1,
        th: 1, caption: 1, col: 1, colgroup: 1, picture: 1, svg: 1,
        iframe: 1, object: 1, embed: 1, video: 1, audio: 1, form: 1, input: 1,
        button: 1, select: 1, textarea: 1, link: 1, meta: 1, title: 1, head: 1, 'o:p': 1
    };
    var STYLE_OK = {
        'color': 1, 'background-color': 1, 'font-family': 1, 'font-size': 1,
        'font-weight': 1, 'font-style': 1, 'text-decoration': 1, 'text-align': 1,
        'margin-left': 1
    };

    // Near-black text colour (pasted in from Salesforce/Word) — treated as the
    // DEFAULT, so it's dropped and the text inherits its surroundings instead.
    function isDefaultBlack(v) {
        v = String(v).trim().toLowerCase();
        if (v === 'black') return true;
        var hx = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
        if (hx) {
            var h = hx[1].length === 3 ? hx[1].replace(/(.)/g, '$1$1') : hx[1];
            return parseInt(h.slice(0, 2), 16) <= 40 && parseInt(h.slice(2, 4), 16) <= 40 && parseInt(h.slice(4, 6), 16) <= 40;
        }
        var rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        return !!rgb && (+rgb[1] <= 40 && +rgb[2] <= 40 && +rgb[3] <= 40);
    }

    function cleanStyle(value) {
        var out = [];
        String(value || '').split(';').forEach(function (decl) {
            var i = decl.indexOf(':');
            if (i < 0) return;
            var prop = decl.slice(0, i).trim().toLowerCase();
            var val = decl.slice(i + 1).trim();
            if (!STYLE_OK[prop] || !val) return;
            if (/url\s*\(|expression|javascript:|@import/i.test(val)) return; // no css injection
            // Drop near-black TEXT colour so it inherits — white in the dark manager,
            // black on Salesforce's white background — instead of being baked black
            // (invisible in dark mode). Other colours are kept as chosen.
            if (prop === 'color' && isDefaultBlack(val)) return;
            out.push(prop + ': ' + val);
        });
        return out.join('; ');
    }

    function safeHref(href) {
        var h = String(href || '').trim();
        return /^(https?:|mailto:|tel:)/i.test(h) ? h : '';
    }

    function copyAttrs(src, el, tag) {
        if (tag === 'a') {
            var href = safeHref(src.getAttribute('href'));
            if (href) {
                el.setAttribute('href', href);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener');
            }
        }
        if (tag === 'img') {
            var imgSrc = String(src.getAttribute('src') || '');
            // Embedded raster images or https only — never svg (it can carry script).
            if (/^(data:image\/(png|jpe?g|gif|webp|bmp);base64,|https:\/\/)/i.test(imgSrc)) {
                el.setAttribute('src', imgSrc);
                var alt = src.getAttribute('alt'); if (alt) el.setAttribute('alt', alt);
            }
        }
        var decls = src.getAttribute('style') || '';
        if (tag === 'font') { // legacy <font color/face/size> -> inline style (survives as a span)
            var c = src.getAttribute('color'); if (c) decls = 'color: ' + c + '; ' + decls;
            var f = src.getAttribute('face');  if (f) decls = 'font-family: ' + f + '; ' + decls;
            var z = src.getAttribute('size');
            var SZ = { '1': 'x-small', '2': 'small', '3': 'medium', '4': 'large', '5': 'x-large', '6': 'xx-large', '7': 'xxx-large' };
            if (z && SZ[z]) decls = 'font-size: ' + SZ[z] + '; ' + decls;
        }
        var style = cleanStyle(decls); // single pass: validate + drop injection / near-black text
        if (style) el.setAttribute('style', style);
    }

    var BLOCK = { div: 1, p: 1, ul: 1, ol: 1, li: 1, blockquote: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1 };

    function hasDirectChild(node, tagName) {
        for (var i = 0; i < node.childNodes.length; i++) {
            var c = node.childNodes[i];
            if (c.nodeType === 1 && c.tagName.toLowerCase() === tagName) return true;
        }
        return false;
    }
    function hasBlockChild(node) {
        for (var i = 0; i < node.childNodes.length; i++) {
            var c = node.childNodes[i];
            if (c.nodeType === 1 && BLOCK[c.tagName.toLowerCase()]) return true;
        }
        return false;
    }

    function clean(src, dest, doc, depth) {
        if (depth > 50) return;
        var nodes = Array.prototype.slice.call(src.childNodes);
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.nodeType === 3) { dest.appendChild(doc.createTextNode(n.nodeValue)); continue; }
            if (n.nodeType !== 1) continue; // comments etc.
            var tag = n.tagName.toLowerCase();
            if (DROP[tag]) continue;                          // discard subtree
            var outTag = (tag === 'font') ? 'span' : tag;     // normalise legacy <font>
            // <div> → <p>: Salesforce's Quill editor drops bare <div> blocks on paste,
            // so a template's lines would vanish. A div that only wraps block content
            // is unwrapped (so we don't nest <p> badly); otherwise it becomes a <p>.
            if (tag === 'div') {
                if (hasBlockChild(n)) { clean(n, dest, doc, depth + 1); continue; }
                outTag = 'p';
            }
            if (!ALLOWED[outTag]) { clean(n, dest, doc, depth + 1); continue; } // unwrap unknown
            // Indent-nested lists (<ul><ul><li>…) are the malformed structure browsers
            // produce when you indent bullets — Salesforce's Quill editor drops them on
            // paste, losing everything that follows. Unwrap a list that has no <li> of
            // its own so the real items (and following content) survive.
            if ((outTag === 'ul' || outTag === 'ol') && !hasDirectChild(n, 'li')) {
                clean(n, dest, doc, depth + 1);
                continue;
            }
            var el = doc.createElement(outTag);
            copyAttrs(n, el, tag);
            if (outTag === 'img' && !el.getAttribute('src')) continue; // unsafe / empty image dropped
            clean(n, el, doc, depth + 1);
            dest.appendChild(el);
        }
    }

    function sanitize(dirty) {
        if (!dirty) return '';
        var doc = new DOMParser().parseFromString('<body><div id="cyf-x">' + dirty + '</div></body>', 'text/html');
        var src = doc.getElementById('cyf-x');
        if (!src) return '';
        var out = doc.createElement('div');
        clean(src, out, doc, 0);
        return out.innerHTML;
    }

    function looksLikeHtml(str) {
        return /<\/?(p|br|div|span|strong|b|em|i|u|s|ul|ol|li|h[1-6]|a|blockquote|font|img)\b[^>]*>/i.test(String(str || ''));
    }

    function toText(html) {
        var s = String(html || '');
        if (!looksLikeHtml(s)) return s;
        var doc = new DOMParser().parseFromString(s, 'text/html');
        doc.body.querySelectorAll('p, li, br, div, h1, h2, h3, h4, h5, h6, blockquote').forEach(function (el) {
            el.appendChild(doc.createTextNode('\n'));
        });
        return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }

    window.CyforSanitize = { html: sanitize, looksLikeHtml: looksLikeHtml, toText: toText };
}());
