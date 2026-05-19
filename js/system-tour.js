// js/system-tour.js
// מודול מדריך למשתמש (System Tour) - מבוסס Driver.js
// ניתן לשנות ולהרחיב קובץ זה בלבד מבלי לגעת בקבצים אחרים

export function initSystemTour() {
    if (!window.driver || !window.driver.js) {
        console.warn('Driver.js is not loaded');
        return;
    }

    const driver = window.driver.js.driver;

    // ===== עיצוב מותאם לסיור =====
    if (!document.getElementById('tour-custom-style')) {
        const style = document.createElement('style');
        style.id = 'tour-custom-style';
        style.innerHTML = `
            /* ---- פופאובר כללי ---- */
            .driver-popover {
                border-radius: 14px !important;
                box-shadow: 0 8px 32px rgba(10, 47, 114, 0.22), 0 2px 8px rgba(0,0,0,0.12) !important;
                border: 1.5px solid rgba(37, 99, 235, 0.15) !important;
                padding: 0 !important;
                overflow: hidden !important;
                max-width: 380px !important;
                font-family: 'Heebo', sans-serif !important;
                direction: rtl !important;
            }

            /* ---- כותרת הפופאובר ---- */
            .driver-popover-title {
                background: linear-gradient(135deg, #1e40af 0%, #2563eb 100%) !important;
                color: #fff !important;
                padding: 14px 18px 12px !important;
                font-size: 1.05rem !important;
                font-weight: 700 !important;
                letter-spacing: 0.01em !important;
                border-bottom: none !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                text-align: right !important;
            }

            /* ---- תוכן הפופאובר ---- */
            .driver-popover-description {
                padding: 14px 18px !important;
                font-size: 0.92rem !important;
                color: #1e293b !important;
                line-height: 1.7 !important;
                text-align: right !important;
                direction: rtl !important;
            }

            /* ---- כפתורי ניווט ---- */
            .driver-popover-footer {
                padding: 10px 18px 14px !important;
                border-top: 1px solid #e2e8f0 !important;
                display: flex !important;
                gap: 8px !important;
                justify-content: flex-start !important;
                direction: rtl !important;
            }
            .driver-popover-next-btn,
            .driver-popover-prev-btn,
            .driver-popover-done-btn {
                border-radius: 8px !important;
                font-family: 'Heebo', sans-serif !important;
                font-size: 0.88rem !important;
                font-weight: 600 !important;
                padding: 7px 16px !important;
                border: none !important;
                cursor: pointer !important;
                transition: opacity 0.2s !important;
            }
            .driver-popover-next-btn,
            .driver-popover-done-btn {
                background: #2563eb !important;
                color: #fff !important;
            }
            .driver-popover-next-btn:hover,
            .driver-popover-done-btn:hover {
                opacity: 0.88 !important;
            }
            .driver-popover-prev-btn {
                background: #f1f5f9 !important;
                color: #334155 !important;
            }
            .driver-popover-prev-btn:hover {
                background: #e2e8f0 !important;
            }

            /* ---- מונה שלבים ---- */
            .driver-popover-progress-text {
                font-size: 0.8rem !important;
                color: #94a3b8 !important;
                margin-right: auto !important;
                align-self: center !important;
            }

            /* ---- כפתור סגירה ---- */
            .driver-popover-close-btn {
                color: rgba(255,255,255,0.7) !important;
                top: 10px !important;
                left: 12px !important;
                right: auto !important;
                font-size: 1.1rem !important;
            }
            .driver-popover-close-btn:hover {
                color: #fff !important;
            }

            /* ---- שלט הבדגש ---- */
            .tour-badge {
                display: inline-block;
                background: rgba(255,255,255,0.22);
                color: #fff;
                font-size: 0.78rem;
                font-weight: 600;
                padding: 2px 9px;
                border-radius: 20px;
                margin-right: 6px;
                vertical-align: middle;
            }

            /* ---- רשימת נקודות בתיאור ---- */
            .tour-list {
                margin: 6px 0 0 0;
                padding-right: 18px;
                list-style: none;
            }
            .tour-list li {
                margin-bottom: 4px;
                padding-right: 2px;
                position: relative;
            }
            .tour-list li::before {
                content: "←";
                position: absolute;
                right: -16px;
                color: #2563eb;
                font-size: 0.8rem;
                top: 2px;
            }

            /* ---- צבע הדגשה בטקסט ---- */
            .tour-accent {
                color: #1d4ed8;
                font-weight: 700;
            }

            /* ---- קו הפרדה קל ---- */
            .tour-divider {
                border: none;
                border-top: 1px solid #e2e8f0;
                margin: 8px 0;
            }
        `;
        document.head.appendChild(style);
    }

    // ===== שלבי הסיור =====
    const tourDriver = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        overlayColor: 'rgba(15, 35, 90, 0.65)',
        nextBtnText: 'הבא ←',
        prevBtnText: '→ הקודם',
        doneBtnText: '✓ סיום הסיור',
        progressText: 'שלב {{current}} מתוך {{total}}',

        steps: [
            // ── שלב 1: ברכה ──
            {
                element: '.dashboard-main h1',
                popover: {
                    title: '👋 ברוכים הבאים למערכת איגום נתונים - למיזם ח"ץ!',
                    description: `
                        זהו <span class="tour-accent">מסך הבית</span> שלכם — כאן מוצגים כל הניסויים שלכם,
                        גם אלו שיצרתם וגם כאלו שחוקרים אחרים שיתפו איתכם.
                        <hr class="tour-divider">
                        הסיור הקצר הבא ינחה אתכם בכל חלקי המערכת 🚀
                    `,
                    side: 'bottom',
                    align: 'start'
                }
            },

            // ── שלב 2: תפריט ניווט ──
            {
                element: '.sidebar-nav',
                popover: {
                    title: '🗂️ תפריט ניווט',
                    description: `
                        מהתפריט הצדדי תוכלו לגשת לכל חלקי המערכת:
                        <ul class="tour-list">
                            <li><span class="tour-accent">בית</span> — רשימת הניסויים שלכם</li>
                            <li><span class="tour-accent">שליפת ניסוי</span> — ייצוא נתונים לאקסל</li>
                            <li><span class="tour-accent">הסטטיסטיקה שלי</span> — גרפים וניתוחי BI אישיים</li>
                        </ul>
                    `,
                    side: 'left',
                    align: 'center'
                }
            },

            // ── שלב 3: מקרא ──
            {
                element: '.experiments-legend',
                popover: {
                    title: '🏷️ זיהוי סוג הניסוי',
                    description: `
                        כל ניסוי מסומן בצבע שונה כדי להבחין בקלות:
                        <ul class="tour-list">
                            <li>סמל <span class="tour-accent">ירוק (✔️)</span> — ניסוי שאתם הקמתם</li>
                            <li>סמל <span class="tour-accent">כחול (👥)</span> — ניסוי שחוקר אחר שיתף אתכם בו</li>
                        </ul>
                        <hr class="tour-divider">
                        בניסויים משותפים תוכלו לראות וגם לערוך נתונים (בהתאם להרשאות).
                    `,
                    side: 'bottom',
                    align: 'center'
                }
            },

            // ── שלב 4: כפתור ניסוי חדש ──
            {
                element: '#add-experiment-btn',
                popover: {
                    title: '🧪 יצירת ניסוי חדש',
                    description: `
                        <strong>לחצו על הריבוע הזה</strong> כדי להתחיל תיעוד ניסוי חדש.
                        <hr class="tour-divider">
                        תוכלו ליצור כמה ניסויים שתרצו — כל ניסוי מאוחסן בנפרד ואפשר לעבוד עליו מכל מקום.
                    `,
                    side: 'right',
                    align: 'center'
                },
                onNextClick: () => {
                    document.getElementById('add-experiment-btn').click();
                    setTimeout(() => tourDriver.moveNext(), 400);
                }
            },

            // ── שלב 5: מודאל יצירת ניסוי ──
            {
                element: '#new-experiment-modal .modal',
                popover: {
                    title: '✏️ שם הניסוי',
                    description: `
                        הזינו <span class="tour-accent">שם תיאורי לניסוי</span> (למשל: "עגבניות חממה 2025")
                        ולחצו על <strong>"יצירת ניסוי"</strong>.
                        <hr class="tour-divider">
                        לאחר הלחיצה תועברו ישירות לדף הניסוי שבו תוכלו למלא את כל הפרטים.
                    `,
                    side: 'top',
                    align: 'center'
                },
                onDeselected: () => {
                    const modal = document.getElementById('new-experiment-modal');
                    if (modal && !modal.classList.contains('hidden')) {
                        modal.classList.add('hidden');
                    }
                },
                onNextClick: () => {
                    const modal = document.getElementById('new-experiment-modal');
                    if (modal && !modal.classList.contains('hidden')) {
                        modal.classList.add('hidden');
                    }
                    tourDriver.moveNext();
                }
            },

            // ── שלב 6: שליפה לאקסל ──
            {
                element: 'a[href="export.html"]',
                popover: {
                    title: '📊 שליפת נתונים לאקסל',
                    description: `
                        בסיום (או בכל שלב) תוכלו לייצא את נתוני הניסוי לאקסל דרך
                        <span class="tour-accent">שליפת ניסוי</span> בתפריט.
                        <hr class="tour-divider">
                        בחרו ניסוי, סמנו אילו נתונים לייצא — והקובץ יורד ישירות למחשב שלכם.
                    `,
                    side: 'left',
                    align: 'center'
                }
            },

            // ── שלב 7: סיום ──
            {
                element: '.sidebar-footer',
                popover: {
                    title: '✅ מוכנים להתחיל!',
                    description: `
                        אתם מוכנים לעבוד עם מערכת ח"ץ.
                        <hr class="tour-divider">
                        <ul class="tour-list">
                            <li>נתקלתם בבעיה? השתמשו ב<span class="tour-accent">דיווח תקלות</span> כאן למטה</li>
                            <li>יש שאלות? פנו לצ'אטבוט המובנה בפינה השמאלית</li>
                            <li>בתוך כל ניסוי — לחצו על <span class="tour-accent">סיור בניסוי</span> לקבלת הדרכה מפורטת</li>
                        </ul>
                        <hr class="tour-divider">
                        <strong>בהצלחה! 🌟</strong>
                    `,
                    side: 'top',
                    align: 'start'
                }
            }
        ]
    });

    // ── מאזין לכפתור סיור במערכת ──
    const tourBtn = document.getElementById('btn-start-tour');
    if (tourBtn) {
        tourBtn.addEventListener('click', (e) => {
            e.preventDefault();

            // סגירת המודאל אם פתוח
            const modal = document.getElementById('new-experiment-modal');
            if (modal && !modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
            }

            // סגירת התפריט במובייל אם פתוח
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && sidebar.classList.contains('open')) {
                const overlay = document.getElementById('sidebar-overlay');
                if (overlay) overlay.click();
            }

            tourDriver.drive();
        });
    }
}
