// ==================================================
// CYFOR Nucleus Enhancer — Custom dropdown
// Renders a themed listbox over a hidden native <select> (which still holds the
// value + options, so existing `.value` reads/writes and change listeners keep
// working). Needed because Chrome on Linux/GTK renders native <option> lists
// with the OS theme and ignores CSS option colours.
//
//   CyforSelect.enhance(selectEl)  — wrap a <select> once.
//   CyforSelect.sync(selectOrId)   — refresh the visible label after the
//                                    underlying <select> changed programmatically.
// Styling: styles/custom-select.css (.cyf-cs*).
// ==================================================

(function () {
    function enhance(selectEl) {
        if (!selectEl || selectEl.__cyforCS) return;
        selectEl.__cyforCS = true;

        var wrap = document.createElement('div');
        wrap.className = 'cyf-cs';
        selectEl.parentNode.insertBefore(wrap, selectEl);
        wrap.appendChild(selectEl);
        selectEl.classList.add('cyf-cs-native');
        selectEl.setAttribute('tabindex', '-1');
        selectEl.setAttribute('aria-hidden', 'true');

        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'cyf-cs-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (selectEl.getAttribute('aria-label')) trigger.setAttribute('aria-label', selectEl.getAttribute('aria-label'));
        var labelEl = document.createElement('span'); labelEl.className = 'cyf-cs-label';
        var arrowEl = document.createElement('span'); arrowEl.className = 'cyf-cs-arrow'; arrowEl.textContent = '▾'; arrowEl.setAttribute('aria-hidden', 'true');
        trigger.appendChild(labelEl); trigger.appendChild(arrowEl);
        wrap.appendChild(trigger);

        var menu = document.createElement('div');
        menu.className = 'cyf-cs-menu';
        menu.setAttribute('role', 'listbox');
        menu.style.display = 'none';
        wrap.appendChild(menu);

        var activeIdx = -1;

        function syncLabel() {
            var opt = selectEl.options[selectEl.selectedIndex];
            labelEl.textContent = opt ? opt.textContent : (selectEl.getAttribute('data-placeholder') || '');
        }
        function items() { return menu.querySelectorAll('.cyf-cs-item'); }
        function buildMenu() {
            menu.innerHTML = '';
            Array.prototype.forEach.call(selectEl.options, function (opt, i) {
                var item = document.createElement('div');
                item.className = 'cyf-cs-item'
                    + (i === selectEl.selectedIndex ? ' is-selected' : '')
                    + (opt.disabled ? ' is-disabled' : '');
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', i === selectEl.selectedIndex ? 'true' : 'false');
                item.textContent = opt.textContent;
                item.addEventListener('mouseenter', function () { setActive(i); });
                item.addEventListener('click', function () { choose(i); });
                menu.appendChild(item);
            });
        }
        function setActive(i) {
            var list = items();
            if (!list.length) return;
            if (i < 0) i = list.length - 1;
            if (i > list.length - 1) i = 0;
            activeIdx = i;
            list.forEach(function (el, idx) { el.classList.toggle('is-active', idx === i); });
            if (list[i]) list[i].scrollIntoView({ block: 'nearest' });
        }
        function choose(i) {
            var opt = selectEl.options[i];
            if (!opt || opt.disabled) return;
            selectEl.selectedIndex = i;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            syncLabel(); close(); trigger.focus();
        }
        function isOpen() { return menu.style.display !== 'none'; }
        function open() {
            buildMenu();
            menu.style.display = '';
            wrap.classList.add('is-open');
            trigger.setAttribute('aria-expanded', 'true');
            setActive(selectEl.selectedIndex >= 0 ? selectEl.selectedIndex : 0);
            document.addEventListener('mousedown', onOutside, true);
        }
        function close() {
            menu.style.display = 'none';
            wrap.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('mousedown', onOutside, true);
        }
        function onOutside(e) { if (!wrap.contains(e.target)) close(); }

        trigger.addEventListener('click', function () { isOpen() ? close() : open(); });
        trigger.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { close(); return; }
            if (!isOpen()) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(activeIdx); }
        });

        selectEl.__cyforSync = syncLabel;
        syncLabel();
    }

    function sync(elOrId) {
        var el = (typeof elOrId === 'string') ? document.getElementById(elOrId) : elOrId;
        if (el && el.__cyforSync) el.__cyforSync();
    }

    window.CyforSelect = { enhance: enhance, sync: sync };
}());
