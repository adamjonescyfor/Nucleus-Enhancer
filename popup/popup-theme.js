// ==================================================
// CYFOR Nucleus Enhancer — Popup theme picker
// Wires the Auto / Light / Dark control in the footer to
// window.CyforTheme (defined in styles/theme.js).
// ==================================================

(function () {
    function init() {
        var group = document.querySelector('.theme-picker');
        if (!group || !window.CyforTheme) return;
        var buttons = group.querySelectorAll('.theme-opt');

        function reflect(pref) {
            buttons.forEach(function (b) {
                var on = b.getAttribute('data-theme-pref') === (pref || 'auto');
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
                b.classList.toggle('is-active', on);
            });
        }

        // Initial highlight reflects the stored preference (theme.js may still
        // report 'auto' until storage resolves, so read it directly).
        try {
            chrome.storage.sync.get(['uiTheme'], function (res) {
                reflect((res && res.uiTheme) || 'auto');
            });
        } catch (e) {
            reflect('auto');
        }

        buttons.forEach(function (b) {
            b.addEventListener('click', function () {
                var pref = b.getAttribute('data-theme-pref');
                window.CyforTheme.set(pref);
                reflect(pref);
            });
        });

        // "Customise…" opens Chrome's own shortcut-rebinding page (MV3 doesn't
        // allow programmatic rebinding of commands).
        var scBtn = document.getElementById('btn-customise-shortcuts');
        if (scBtn) {
            scBtn.addEventListener('click', function () {
                try { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (e) { /* ignore */ }
            });
        }

        // First-run onboarding banner (shown until dismissed).
        var banner = document.getElementById('onboarding-banner');
        var closeBtn = document.getElementById('onboarding-close');
        if (banner && closeBtn) {
            try {
                chrome.storage.sync.get(['onboardingDismissed'], function (res) {
                    if (!res || !res.onboardingDismissed) banner.style.display = '';
                });
            } catch (e) { /* ignore */ }
            closeBtn.addEventListener('click', function () {
                banner.style.display = 'none';
                try { chrome.storage.sync.set({ onboardingDismissed: true }); } catch (e) { /* ignore */ }
            });
        }

        initWhatsNew();
    }

    // Highlights for the current release — edit on each version bump.
    var WHATS_NEW_ITEMS = [
        'Rich-text template editor (admins) — full formatting, fonts, colour, lists and images, and paste straight from Word.',
        'Assign a template to several teams at once, not just one or Global.',
        'Right-click also fills Exhibit Type and the Forensic Case lookup, and templates carry their formatting into Salesforce.',
        'One theme for everything — popup, manager and the in-page tools, switching live.',
        'Diagnostics — if something misbehaves, capture a log in the popup and send it to Adam so it can be fixed quickly.'
    ];

    // "What's new" banner — shown after an update until dismissed. Fresh installs
    // record the version silently (the welcome banner covers onboarding), and it
    // stays hidden while the welcome banner is still up to avoid stacking two.
    function initWhatsNew() {
        var vBanner = document.getElementById('whatsnew-banner');
        var vClose  = document.getElementById('whatsnew-close');
        if (!vBanner || !vClose) return;
        try {
            var current = chrome.runtime.getManifest().version;
            chrome.storage.sync.get(['lastSeenVersion', 'onboardingDismissed'], function (res) {
                var last = res && res.lastSeenVersion;
                if (!last) {
                    chrome.storage.sync.set({ lastSeenVersion: current });
                    return;
                }
                if (last === current) return;
                if (!(res && res.onboardingDismissed)) return; // welcome banner first

                document.getElementById('whatsnew-version').textContent = 'in v' + current;
                var list = document.getElementById('whatsnew-list');
                list.innerHTML = '';
                WHATS_NEW_ITEMS.forEach(function (text) {
                    var li = document.createElement('li');
                    li.textContent = text;
                    list.appendChild(li);
                });
                vBanner.style.display = '';
                vClose.addEventListener('click', function () {
                    vBanner.style.display = 'none';
                    try { chrome.storage.sync.set({ lastSeenVersion: current }); } catch (e) { /* ignore */ }
                });
            });
        } catch (e) { /* ignore */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
