// =========================================
// Accessibility Widget - Shared JS
// =========================================

(function () {
    'use strict';

    const a11yToggleBtn = document.getElementById('btn-a11y');
    const a11yMenu = document.getElementById('a11y-menu');
    const btnContrast = document.getElementById('toggle-contrast');
    const btnTextSize = document.getElementById('toggle-text-size');
    const btnResetA11y = document.getElementById('reset-a11y');

    if (!a11yToggleBtn || !a11yMenu) return;

    // Toggle Menu
    a11yToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = a11yToggleBtn.getAttribute('aria-expanded') === 'true';
        a11yToggleBtn.setAttribute('aria-expanded', !isExpanded);
        a11yMenu.classList.toggle('show');
    });

    // Close menu on outside click
    document.addEventListener('click', (e) => {
        if (!a11yMenu.contains(e.target) && !a11yToggleBtn.contains(e.target)) {
            a11yMenu.classList.remove('show');
            a11yToggleBtn.setAttribute('aria-expanded', 'false');
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && a11yMenu.classList.contains('show')) {
            a11yMenu.classList.remove('show');
            a11yToggleBtn.setAttribute('aria-expanded', 'false');
            a11yToggleBtn.focus();
        }
    });

    // Load saved preferences
    if (localStorage.getItem('a11y-contrast') === 'true') toggleContrast(true);
    if (localStorage.getItem('a11y-text') === 'true') toggleTextSize(true);

    function toggleContrast(forceState) {
        const isActivating = forceState !== undefined ? forceState : !document.body.classList.contains('a11y-high-contrast');
        document.body.classList.toggle('a11y-high-contrast', isActivating);
        if (btnContrast) btnContrast.classList.toggle('active', isActivating);
        localStorage.setItem('a11y-contrast', isActivating);
    }

    function toggleTextSize(forceState) {
        const isActivating = forceState !== undefined ? forceState : !document.body.classList.contains('a11y-large-text');
        document.body.classList.toggle('a11y-large-text', isActivating);
        if (btnTextSize) btnTextSize.classList.toggle('active', isActivating);
        localStorage.setItem('a11y-text', isActivating);
    }

    if (btnContrast) btnContrast.addEventListener('click', () => toggleContrast());
    if (btnTextSize) btnTextSize.addEventListener('click', () => toggleTextSize());
    if (btnResetA11y) {
        btnResetA11y.addEventListener('click', () => {
            toggleContrast(false);
            toggleTextSize(false);
        });
    }
})();

