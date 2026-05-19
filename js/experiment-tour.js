// js/experiment-tour.js
// מדריך למשתמש בתוך עמוד הניסוי — מבוסס Driver.js
// ניתן לשנות ולהרחיב קובץ זה בלבד כדי לעדכן את הסיור בעמוד הניסוי

export function initExperimentTour() {
    if (!window.driver || !window.driver.js) {
        console.warn('Driver.js is not loaded');
        return;
    }

    const driver = window.driver.js.driver;

    // ===== עיצוב מותאם (זהה ל-system-tour.js) =====
    if (!document.getElementById('tour-custom-style')) {
        const style = document.createElement('style');
        style.id = 'tour-custom-style';
        style.innerHTML = `
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
            .driver-popover-title {
                background: linear-gradient(135deg, #1e40af 0%, #2563eb 100%) !important;
                color: #fff !important;
                padding: 14px 18px 12px !important;
                font-size: 1.05rem !important;
                font-weight: 700 !important;
                border-bottom: none !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                text-align: right !important;
            }
            .driver-popover-description {
                padding: 14px 18px !important;
                font-size: 0.92rem !important;
                color: #1e293b !important;
                line-height: 1.7 !important;
                text-align: right !important;
                direction: rtl !important;
            }
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
            .driver-popover-done-btn:hover { opacity: 0.88 !important; }
            .driver-popover-prev-btn {
                background: #f1f5f9 !important;
                color: #334155 !important;
            }
            .driver-popover-prev-btn:hover { background: #e2e8f0 !important; }
            .driver-popover-progress-text {
                font-size: 0.8rem !important;
                color: #94a3b8 !important;
                margin-right: auto !important;
                align-self: center !important;
            }
            .driver-popover-close-btn {
                color: rgba(255,255,255,0.7) !important;
                top: 10px !important;
                left: 12px !important;
                right: auto !important;
                font-size: 1.1rem !important;
            }
            .driver-popover-close-btn:hover { color: #fff !important; }
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
            .tour-accent { color: #1d4ed8; font-weight: 700; }
            .tour-divider {
                border: none;
                border-top: 1px solid #e2e8f0;
                margin: 8px 0;
            }
        `;
        document.head.appendChild(style);
    }

    // ===== שלבי הסיור בעמוד הניסוי =====
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

            // ── שלב 1: ברכה כללית ──
            {
                element: '.breadcrumb',
                popover: {
                    title: '📋 ברוכים לעמוד הניסוי!',
                    description: `
                        כאן תוכלו לתעד ולנהל את כל פרטי הניסוי שיצרתם.
                        <hr class="tour-divider">
                        הפס העליון (פירורי לחם) מראה תמיד את המיקום הנוכחי שלכם בתוך הניסוי.
                        הסיור הקצר הזה יסביר כל חלק 🚀
                    `,
                    side: 'bottom',
                    align: 'start'
                }
            },

            // ── שלב 2: תפריט הניסוי בסיידבר ──
            {
                element: '.experiment-nav-item',
                popover: {
                    title: '🗂️ ניווט בין חלקי הניסוי',
                    description: `
                        התפריט הצדדי מחולק לשלושה אזורים עיקריים:
                        <ul class="tour-list">
                            <li><span class="tour-accent">תוכנית הניסוי</span> — מטרות, אתר וטיפולים</li>
                            <li><span class="tour-accent">הכנות לניסוי</span> — גידול, מבנה, קרקע, טפטוף</li>
                            <li><span class="tour-accent">מהלך הניסוי</span> — השקיה, צימוח, אקלים ועוד</li>
                        </ul>
                        לחצו על כל סעיף כדי לפתוח אותו.
                    `,
                    side: 'left',
                    align: 'start'
                }
            },

            // ── שלב 3: תוכנית הניסוי ──
            {
                element: '#view-basic',
                popover: {
                    title: '📝 תוכנית הניסוי',
                    description: `
                        זהו המסך הראשי — מלאו כאן את הפרטים הבסיסיים:
                        <ul class="tour-list">
                            <li>חוקר מוביל, שנה וחודש הניסוי</li>
                            <li>אתר הניסוי וקורדינטות (כולל בחירה מהמפה)</li>
                            <li>מטרת הניסוי ותקציר</li>
                            <li>מספר טיפולים, חזרות ומשתנים</li>
                            <li>חבילת עבודה במסגרת מיזם ח"ץ</li>
                        </ul>
                    `,
                    side: 'right',
                    align: 'start'
                }
            },

            // ── שלב 4: שותפים ──
            {
                element: '#partner-search',
                popover: {
                    title: '👥 הוספת שותפים לניסוי',
                    description: `
                        הקלידו <span class="tour-accent">שם או כתובת אימייל</span> של חוקר רשום במערכת.
                        <hr class="tour-divider">
                        המערכת תציע רשימת חוקרים בזמן אמת. לאחר לחיצה על <strong>+</strong>:
                        <ul class="tour-list">
                            <li>הניסוי יופיע בדשבורד של השותף עם סמל כחול</li>
                            <li>השותף יוכל לצפות ולערוך את הנתונים</li>
                            <li>ניתן להסיר שותף בכל עת</li>
                        </ul>
                    `,
                    side: 'bottom',
                    align: 'start'
                }
            },

            // ── שלב 5: הכנות לניסוי ──
            {
                element: '#prep-toggle',
                popover: {
                    title: '🌱 הכנות לניסוי',
                    description: `
                        לחצו כדי לפתוח את ארבעת הסעיפים:
                        <ul class="tour-list">
                            <li><span class="tour-accent">פרטי הגידול</span> — סוג, זן, מועד שתילה, עומד ושטח</li>
                            <li><span class="tour-accent">מבנה</span> — חממה, שדה, גג, כיוון</li>
                            <li><span class="tour-accent">טיפול בקרקע</span> — קומפוסט, חיטוי, מצע</li>
                            <li><span class="tour-accent">סוג ופריסת הטפטוף</span> — ספיקה, מרחקים, תזמון</li>
                        </ul>
                    `,
                    side: 'left',
                    align: 'start'
                }
            },

            // ── שלב 6: toggle שיתוף נתונים ──
            {
                element: '#shared-toggle-container',
                popover: {
                    title: '🔄 נתונים משותפים לכל הטיפולים',
                    description: `
                        בחלקי ה"הכנות" יש מתג חשוב —
                        <span class="tour-accent">נתונים זהים לכלל הטיפולים</span>.
                        <hr class="tour-divider">
                        <ul class="tour-list">
                            <li><strong>פעיל (ברירת מחדל)</strong> — ממלאים פעם אחת לכל הטיפולים</li>
                            <li><strong>כבוי</strong> — כרטיסייה נפרדת לכל טיפול בנפרד</li>
                        </ul>
                        כיבוי המתג יוצר לשוניות אחת לכל טיפול בחלק העליון של המסך.
                    `,
                    side: 'bottom',
                    align: 'start'
                }
            },

            // ── שלב 7: מהלך הניסוי ──
            {
                element: '#progress-toggle',
                popover: {
                    title: '📈 מהלך הניסוי',
                    description: `
                        כאן תוכלו לתעד נתונים שנאספים <strong>לאורך</strong> הניסוי:
                        <ul class="tour-list">
                            <li><span class="tour-accent">השקיה ודשן</span> — העלאת קבצי נתונים עם תאריכים</li>
                            <li><span class="tour-accent">צימוח</span> — מדידות גדילה עם תאריך מדידה</li>
                            <li><span class="tour-accent">אקלים וסנסורים</span> — קובצי נתוני סנסורים</li>
                            <li><span class="tour-accent">אגרוטכניקה</span> — פעולות גידול מיוחדות</li>
                            <li><span class="tour-accent">הגנת הצומח</span> — מחלות, מזיקים וריסוסים</li>
                        </ul>
                    `,
                    side: 'left',
                    align: 'start'
                }
            },

            // ── שלב 8: נתוני יבול ──
            {
                element: 'a[data-view="yield"]',
                popover: {
                    title: '🌾 נתוני יבול',
                    description: `
                        לאחר הקטיף, הזינו כאן את <span class="tour-accent">נתוני היבול</span>:
                        <ul class="tour-list">
                            <li>מדידות — תאריך, חזרה, קומת פרי, כמות ואיכות</li>
                            <li>פגעים — תיעוד נזקים ביבול</li>
                        </ul>
                        ניתן להוסיף שורות מדידה כמה פעמים שנדרש לאורך הניסוי.
                    `,
                    side: 'left',
                    align: 'center'
                }
            },

            // ── שלב 9: יומן אירועים ──
            {
                element: 'a[data-view="events"]',
                popover: {
                    title: '📓 יומן אירועים',
                    description: `
                        כאן תוכלו לרשום <span class="tour-accent">אירועים חשובים</span> שאירעו במהלך הניסוי —
                        תקלות, תצפיות מיוחדות, שינויי תנאים וכל הערה שחשוב לתעד.
                        <hr class="tour-divider">
                        האירועים מסודרים לפי תאריך ומהווים יומן כרונולוגי של הניסוי.
                    `,
                    side: 'left',
                    align: 'center'
                }
            },

            // ── שלב 10: ניתוחים פיננסיים ──
            {
                element: 'a[data-view="financial-analysis"]',
                popover: {
                    title: '💰 ניתוחים פיננסיים',
                    description: `
                        בסעיף זה ניתן לצרף <span class="tour-accent">קבצי נתונים פיננסיים</span>
                        — עלויות, תשומות וניתוחי רווחיות הקשורים לניסוי.
                    `,
                    side: 'left',
                    align: 'center'
                }
            },

            // ── שלב 11: כפתור שמירה ──
            {
                element: '.btn-save',
                popover: {
                    title: '💾 שמירת הנתונים',
                    description: `
                        לאחר מילוי או עדכון נתונים, <strong>חשוב ללחוץ על כפתור השמירה</strong>
                        כדי שהשינויים ישמרו בשרת.
                        <hr class="tour-divider">
                        ⚠️ <span class="tour-accent">אין שמירה אוטומטית</span> — כל מעבר בין מסכים
                        לפני שמירה עלול לגרום לאובדן הנתונים שהוזנו.
                    `,
                    side: 'top',
                    align: 'center'
                }
            },

            // ── שלב 12: סיום ──
            {
                element: '.sidebar-footer',
                popover: {
                    title: '✅ מוכנים לעבודה!',
                    description: `
                        עכשיו אתם מכירים את כל חלקי עמוד הניסוי.
                        <hr class="tour-divider">
                        <ul class="tour-list">
                            <li>לחזרה לרשימת הניסויים — <span class="tour-accent">בית</span> בתפריט</li>
                            <li>לייצוא נתונים לאקסל — <span class="tour-accent">שליפת ניסוי</span></li>
                            <li>לבעיות — <span class="tour-accent">דיווח תקלות</span> כאן למטה</li>
                        </ul>
                        <strong>בהצלחה בניסוי! 🌟</strong>
                    `,
                    side: 'top',
                    align: 'start'
                }
            }
        ]
    });

    // ── מאזין לכפתור הסיור ──
    const tourBtn = document.getElementById('btn-start-experiment-tour');
    if (tourBtn) {
        tourBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && sidebar.classList.contains('open')) {
                const overlay = document.getElementById('sidebar-overlay');
                if (overlay) overlay.click();
            }
            tourDriver.drive();
        });
    }
}
