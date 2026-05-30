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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
