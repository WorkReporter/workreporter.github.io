/**
 * cookie-consent.js
 * Standalone cookie-consent banner + declined-overlay.
 * Include this script (non-module) in every HTML page.
 * Storage key: 'cookieConsent'  values: 'accepted' | 'declined'
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'cookieConsent';

    /* ─── Inject CSS ─────────────────────────────────────────── */
    const style = document.createElement('style');
    style.textContent = `
        /* ── Cookie Consent Banner ── */
        #cookie-banner {
            position: fixed; bottom: 0; left: 0; right: 0;
            background: rgba(15, 23, 42, 0.97);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            color: #e2e8f0;
            padding: 20px 32px;
            z-index: 9999;
            display: flex; align-items: center; justify-content: space-between;
            gap: 24px; flex-wrap: wrap;
            border-top: 1px solid rgba(0, 102, 204, 0.3);
            box-shadow: 0 -4px 30px rgba(0, 0, 0, 0.25);
            animation: cc-slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            font-family: 'Heebo', -apple-system, sans-serif;
            direction: rtl;
        }
        @keyframes cc-slideUp {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
        }
        #cookie-banner.cc-hide {
            animation: cc-slideDown 0.3s ease forwards;
        }
        @keyframes cc-slideDown {
            to { transform: translateY(110%); opacity: 0; }
        }
        .cc-text { display: flex; align-items: flex-start; gap: 14px; flex: 1; min-width: 260px; }
        .cc-icon  { font-size: 1.8rem; flex-shrink: 0; line-height: 1; }
        .cc-msg   { font-size: 0.92rem; line-height: 1.6; }
        .cc-msg strong { color: #ffffff; font-size: 1rem; display: block; margin-bottom: 4px; }
        .cc-msg a { color: #60a5fa; text-decoration: underline; }
        .cc-msg code {
            background: rgba(255,255,255,0.1);
            padding: 1px 5px; border-radius: 4px;
            font-family: monospace; font-size: 0.85em;
        }
        .cc-actions { display: flex; gap: 12px; flex-shrink: 0; }
        .cc-btn {
            padding: 10px 22px; border-radius: 8px;
            font-size: 0.9rem; font-weight: 600;
            cursor: pointer; border: none;
            transition: all 0.2s ease; white-space: nowrap;
            font-family: 'Heebo', -apple-system, sans-serif;
        }
        .cc-btn-accept { background: #0066cc; color: #fff; }
        .cc-btn-accept:hover { background: #3385ff; }
        .cc-btn-decline {
            background: transparent;
            border: 1px solid rgba(226, 232, 240, 0.3);
            color: #94a3b8;
        }
        .cc-btn-decline:hover { background: rgba(226,232,240,0.08); color: #e2e8f0; }

        /* ── Declined Overlay ── */
        #cookie-declined-overlay {
            position: fixed; inset: 0;
            background: rgba(15, 23, 42, 0.97);
            z-index: 10000;
            display: none;
            align-items: center; justify-content: center;
            flex-direction: column; gap: 16px;
            color: #e2e8f0; text-align: center; padding: 32px;
            font-family: 'Heebo', -apple-system, sans-serif;
            direction: rtl;
        }
        #cookie-declined-overlay.cc-visible { display: flex; }
        .cc-dec-icon  { font-size: 3rem; }
        .cc-dec-title { font-size: 1.4rem; font-weight: 700; color: #fff; }
        .cc-dec-msg   { font-size: 1rem; color: #94a3b8; max-width: 480px; line-height: 1.7; }
        .cc-dec-countdown { font-size: 0.95rem; color: #60a5fa; margin-top: 8px; }
        .cc-btn-change-mind {
            margin-top: 8px;
            padding: 11px 28px; border-radius: 8px;
            font-size: 0.95rem; font-weight: 600;
            cursor: pointer; border: none;
            background: #0066cc; color: #fff;
            font-family: 'Heebo', -apple-system, sans-serif;
            transition: background 0.2s ease;
        }
        .cc-btn-change-mind:hover { background: #3385ff; }
    `;
    document.head.appendChild(style);

    /* ─── Inject HTML ────────────────────────────────────────── */
    const banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.style.display = 'none';
    banner.innerHTML = `
        <div class="cc-text">
            <span class="cc-icon">🍪</span>
            <div class="cc-msg">
                <strong>האתר משתמש בעוגיות (Cookies)</strong>
                אנו משתמשים ב-<strong>Google Analytics</strong> לצורך ניטור ותיעוד אופן השימוש. חלק מהנתונים עשויים להיות מקושרים לחשבונך במערכת לאבטחה ושיפור השירות.
                העוגיות כוללות: <code>_ga</code> ו-<code>_ga_QTPXWHZ06N</code>.
                לפרטים נוספים ראו <a href="terms.html" target="_blank">תנאי השימוש</a>.
            </div>
        </div>
        <div class="cc-actions">
            <button class="cc-btn cc-btn-accept" id="cc-accept-btn">מסכים/ה ✓</button>
            <button class="cc-btn cc-btn-decline" id="cc-decline-btn">לא מסכים/ה</button>
        </div>
    `;
    document.body.appendChild(banner);

    const overlay = document.createElement('div');
    overlay.id = 'cookie-declined-overlay';
    overlay.innerHTML = `
        <div class="cc-dec-icon">🚫</div>
        <div class="cc-dec-title">לא ניתן להמשיך ללא הסכמה לעוגיות</div>
        <div class="cc-dec-msg">
            השימוש באתר מיזם ח\"ץ מותנה בהסכמה לאיסוף נתוני שימוש באמצעות Google Analytics. חלק מהנתונים עשויים להיות
            מקושרים לחשבונך לשיפור השירות ואבטחת מידע. ללא הסכמה זו, לא נוכל לספק גישה לאתר.
        </div>
        <button class="cc-btn-change-mind" id="cc-change-mind-btn">שיניתי את דעתי — מסכים/ה ✓</button>
        <div class="cc-dec-countdown" id="cc-countdown-msg">
            מועבר/ת לדף הבית של Google בעוד <span id="cc-countdown-num">5</span> שניות...
        </div>
    `;
    document.body.appendChild(overlay);

    /* ─── Logic ──────────────────────────────────────────────── */
    let countdownTimer = null;

    function startCountdown() {
        let n = 5;
        countdownTimer = setInterval(() => {
            n--;
            const el = document.getElementById('cc-countdown-num');
            if (el) el.textContent = n;
            if (n <= 0) {
                clearInterval(countdownTimer);
                window.location.href = 'https://www.google.com';
            }
        }, 1000);
    }

    function showDeclinedOverlay() {
        overlay.classList.add('cc-visible');
        startCountdown();
    }

    function acceptCookies() {
        localStorage.setItem(STORAGE_KEY, 'accepted');
        // Hide banner smoothly
        banner.classList.add('cc-hide');
        setTimeout(() => banner.remove(), 350);
        // If declining overlay is showing, hide it and reload
        if (overlay.classList.contains('cc-visible')) {
            if (countdownTimer) clearInterval(countdownTimer);
            overlay.classList.remove('cc-visible');
        }
        // Reload so firebase-config can initialise analytics with consent
        location.reload();
    }

    const savedChoice = localStorage.getItem(STORAGE_KEY);

    if (savedChoice === 'accepted') {
        // Nothing to show — analytics init handled by firebase-config.js
        return;
    }

    if (savedChoice === 'declined') {
        showDeclinedOverlay();
        // Attach change-mind button listener after DOM is ready
        overlay.querySelector('#cc-change-mind-btn').addEventListener('click', acceptCookies);
        return;
    }

    // No decision yet — show banner
    banner.style.display = 'flex';
    banner.querySelector('#cc-accept-btn').addEventListener('click', acceptCookies);
    banner.querySelector('#cc-decline-btn').addEventListener('click', () => {
        localStorage.setItem(STORAGE_KEY, 'declined');
        banner.style.display = 'none';
        showDeclinedOverlay();
        overlay.querySelector('#cc-change-mind-btn').addEventListener('click', acceptCookies);
    });

})();
