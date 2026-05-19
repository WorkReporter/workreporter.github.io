// =========================================
// Chatbot / FAQ Widget - Shared JS
// Page-context-aware Q&A
// =========================================

(function () {
    'use strict';

    const chatToggleBtn = document.getElementById('btn-chat-toggle');
    const chatPanel = document.getElementById('chat-panel');
    const btnCloseChat = document.getElementById('btn-close-chat');
    const faqListEl = document.getElementById('faq-list');
    const activeView = document.getElementById('chat-active-view');
    const userQuestionEl = document.getElementById('chat-user-question');
    const botAnswerEl = document.getElementById('chat-bot-answer');
    const typingIndicator = document.getElementById('typing-indicator');
    const btnBackChat = document.getElementById('btn-back-chat');

    if (!chatToggleBtn || !chatPanel) return;

    // ── Page-context-aware FAQ data ──
    const pageContext = document.body.getAttribute('data-page-context') || 'auth';

    const faqDatabase = {
        auth: {
            intro: 'שלום! אני העוזר הווירטואלי של המערכת. במה אוכל לעזור?',
            questions: [
                { id: 'q1', text: 'מהי המטרה של מיזם ח"ץ עגבניות?', answer: 'מטרת מיזם ח״ץ (חקלאות צומחת) הינה העלאת כמות ואיכות היבול, והורדת נקודת האיזון הכלכלית של עגבניות הגדלות במבני צמיחה, תוך שמירה על עקרונות החקלאות המקיימת ומינימום ידיים עובדות.' },
                { id: 'q2', text: 'אילו סוגי נתונים ניתן להזין למערכת?', answer: 'המערכת תומכת בניהול מחקר הוליסטי: החל מפרטי הגידול והמבנה, דרך טיפולי קרקע (חיטוי, קומפוסט), סוג ופריסת הטפטוף (השקיה ודישון), אגרוטכניקה (הדליות, גיזום), ועד קליטת נתוני יבול ויומן אירועים למעקב, כולל אפשרות צירוף קבצים ומיקומי GPS.' },
                { id: 'q3', text: 'איך מצטרפים?', answer: "להצטרפות יש למלא את פרטיך בעמוד ההרשמה: לאחר מכן, הנהלת המיזם תבחן את הבקשה. יש להמתין לאישור המנהל/ת, במידת הצורך ניתן לפנות בדוא״ל: yehudah@volcani.agri.gov.il ." },
                { id: 'q4', text: 'יש הסבר על השימוש במערכת?', answer: 'כן, לאחר ההתחברות יוצגו כאן שאלות ותשובות מותאמות.' },
                { id: 'q5', text: 'האם יש תנאי שימוש?', answer: 'אין מסמך תנאי שימוש נפרד. השימוש במערכת מיועד למשתמשים מורשים בלבד ובהתאם למדיניות האבטחה הארגונית.' },
                { id: 'q6', icon: 'lock', text: '🔒 האם המערכת מאובטחת?', answer: 'הגישה למידע נאכפת באמצעות כללי אבטחה בצד שרת.' }
            ]
        },
        dashboard: {
            intro: 'שלום! אני העוזר הווירטואלי. אשמח לעזור בניווט במערכת.',
            questions: [
                { id: 'dq1', text: 'איך יוצרים ניסוי חדש?', answer: 'ליצירת ניסוי חדש יש ללחוץ על כפתור "הוספת ניסוי חדש" בעמוד הראשי (כאן). יש למלא את שם הניסוי ולאחר מכן לבחור "יצירת ניסוי". לאחר היצירה, הניסוי יופיע ברשימת הניסויים וניתן להתחיל להזין נתונים.' },
                { id: 'dq2', text: 'איך משתפים ניסוי עם חוקר/ת חקלאי/ת אחר/ת?', answer: 'שיתוף ניסוי מתבצע מתוך עמוד הניסוי עצמו. יש ללחוץ על השדה "שותפים", לבצע חיפוש ע"פ שם או מייל ולאחר מכן לבחור את המשתמש הרצוי מהרשימה, השותף יראה את הניסוי בדשבורד שלו.' },
                { id: 'dq3', text: 'איך מזינים נתונים לניסוי?', answer: 'הזנת נתונים מתבצעת בתוך עמוד הניסוי, ניתן למלא את השדות המתאימים וכן לבצע העלאת קבצים במידת הצורך. לאחר לחיצה על "שמירה" כל הנתונים נשמרים אוטומטית בענן.' },
                { id: 'dq4', text: 'איך מתנתקים מהמערכת?', answer: 'להתנתקות מהמערכת יש ללחוץ על כפתור "התנתקות" שנמצא בתחתית הסרגל הצדדי (sidebar). ההתנתקות תעביר למסך ההתחברות. חשוב לבצע התנתקות בסיום העבודה לשמירה על אבטחת המידע.' }
            ]
        },
        admin: {
            intro: 'שלום מנהל/ת! אני העוזר הווירטואלי. במה אוכל לעזור?',
            questions: [
                { id: 'aq1', text: 'איך מאשרים משתמש חדש?', answer: 'לאישור משתמש חדש יש לעבור לעמוד "ניהול משתמשים". תוצג רשימת משתמשים ממתינים לאישור. יש לבחור בכפתור "אשר" ליד המשתמש הרצוי. לאחר האישור, המשתמש יוכל להתחבר ולגשת למערכת.' },
                { id: 'aq2', text: 'איך משנים תפקיד למשתמש?', answer: 'שינוי תפקיד מתבצע מעמוד "ניהול משתמשים". יש לבחור את המשתמש הרצוי ולאחר מכן לשנות את התפקיד בין חוקר, חקלאי ומנהל. חשוב לשים לב: הענקת הרשאת מנהל מאפשרת גישה מלאה למערכת.' },
                { id: 'aq3', text: 'איך צופים בכל הניסויים במערכת?', answer: 'מנהלי המערכת יכולים לצפות בכל הניסויים דרך עמוד "ניהול ניסויים". כאן מוצגת רשימה מלאה של כל הניסויים במערכת, כולל פרטי יוצר הניסוי, תאריכי יצירה ומצב הניסוי.' },
                { id: 'aq4', text: 'מה קורה כשחוסמים משתמש?', answer: 'כשחוסמים משתמש, הוא לא יוכל להתחבר יותר למערכת. הנתונים שהזין נשמרים אך אינם נגישים לו. ניתן לבטל את החסימה בכל עת מעמוד ניהול המשתמשים על ידי לחיצה על "בטל חסימה".' }
            ]
        },
        experiment: {
            intro: 'שלום! אני העוזר הווירטואלי. יש לך שאלות לגבי ניהול הניסוי?',
            questions: [
                { id: 'eq1', text: 'איך מוסיפים טיפול חדש לניסוי?', answer: 'להוספת טיפול חדש יש ללחוץ על כפתור "הוספת טיפול" בתוך עמוד הניסוי. יש למלא את שם הטיפול, סוג הטיפול (השקיה, דישון, הדברה וכו\'), פרטים נוספים ולשמור. הטיפול יופיע ברשימת הטיפולים של הניסוי.' },
                { id: 'eq2', text: 'איך מעלים קובץ נתונים?', answer: 'העלאת קבצים מתבצעת מתוך עמוד הניסוי. יש לבחור "העלאת קובץ" או את אייקון הצירוף, ולאחר מכן לבצע בחירת קובץ מהמכשיר (תמונות, אקסל, PDF). הקובץ יועלה לענן ויהיה זמין לכל שותפי הניסוי.' },
                { id: 'eq3', text: 'איך מתעדים אירוע ביומן?', answer: 'תיעוד אירוע ביומן מתבצע בטאב "יומן אירועים". יש לבחור "אירוע חדש", להזין תאריך ותיאור, ובמידת הצורך לבצע העלאת קובץ.' },
                { id: 'eq4', text: 'האם ניתן לייצא נתונים מהניסוי?', answer: 'כרגע עובדים על זה :) יהיה בהמשך' }
            ]
        }
    };

    // Get the relevant FAQ data
    const currentFaq = faqDatabase[pageContext] || faqDatabase.auth;

    // ── Build FAQ list ──
    function buildFaqList() {
        if (!faqListEl) return;
        faqListEl.innerHTML = '';

        const intro = document.createElement('p');
        intro.className = 'chat-intro';
        intro.textContent = currentFaq.intro;
        faqListEl.appendChild(intro);

        currentFaq.questions.forEach(q => {
            const item = document.createElement('div');
            item.className = 'faq-item';
            item.setAttribute('data-id', q.id);
            item.setAttribute('tabindex', '0');
            item.setAttribute('role', 'button');

            // Strip any leading emoji used as placeholder, then render FA icon if specified
            const cleanText = q.text.replace(/^[^\u0000-\u007F\u0590-\u05FF\u200F\uFB00-\uFDFF\uFE70-\uFEFF\s]+\s*/, '');

            if (q.icon === 'lock') {
                item.innerHTML = `<i class="fa-solid fa-lock faq-icon-lock" aria-hidden="true"></i><span>${cleanText}</span>`;
            } else {
                item.textContent = q.text;
            }

            faqListEl.appendChild(item);
        });
    }

    buildFaqList();

    let typeWriterTimeout;

    // ── Open/Close Chat ──
    chatToggleBtn.addEventListener('click', () => {
        chatPanel.classList.add('show');
        chatToggleBtn.style.transform = 'scale(0)';
    });

    if (btnCloseChat) {
        btnCloseChat.addEventListener('click', () => {
            chatPanel.classList.remove('show');
            chatToggleBtn.style.transform = 'scale(1)';
        });
    }

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && chatPanel.classList.contains('show')) {
            chatPanel.classList.remove('show');
            chatToggleBtn.style.transform = 'scale(1)';
        }
    });

    // ── Handle FAQ Click ──
    faqListEl.addEventListener('click', (e) => {
        const item = e.target.closest('.faq-item');
        if (!item) return;
        handleFaqClick(item);
    });

    // Keyboard support for FAQ items
    faqListEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const item = e.target.closest('.faq-item');
            if (!item) return;
            e.preventDefault();
            handleFaqClick(item);
        }
    });

    function handleFaqClick(item) {
        const questionId = item.getAttribute('data-id');
        const questionText = item.textContent;
        const faqEntry = currentFaq.questions.find(q => q.id === questionId);
        if (!faqEntry) return;

        // UI Transitions
        faqListEl.style.display = 'none';
        if (activeView) activeView.classList.add('show');
        if (userQuestionEl) userQuestionEl.textContent = questionText;
        if (botAnswerEl) botAnswerEl.style.display = 'none';
        if (btnBackChat) btnBackChat.style.display = 'none';
        if (typingIndicator) typingIndicator.classList.add('show');

        // Clear previous typing
        clearTimeout(typeWriterTimeout);
        if (botAnswerEl) botAnswerEl.innerHTML = '';

        // Simulate network delay
        setTimeout(() => {
            if (typingIndicator) typingIndicator.classList.remove('show');
            if (botAnswerEl) botAnswerEl.style.display = 'block';
            simulateLLMTyping(faqEntry.answer);
        }, 1500);
    }

    // ── Typewriter Effect ──
    function simulateLLMTyping(fullText) {
        // Check if the answer contains HTML (like links)
        const hasHTML = /<[^>]+>/.test(fullText);

        if (hasHTML) {
            // If HTML detected, render directly without typewriter effect
            if (botAnswerEl) {
                botAnswerEl.innerHTML = fullText;
                const chatBody = document.getElementById('chat-body');
                if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
            }
            if (btnBackChat) btnBackChat.style.display = 'flex';
        } else {
            // Original typewriter effect for plain text
            let index = 0;

            function typeNextChar() {
                if (index < fullText.length) {
                    botAnswerEl.innerHTML += fullText.charAt(index);
                    index++;
                    const delay = Math.floor(Math.random() * 20) + 15;
                    typeWriterTimeout = setTimeout(typeNextChar, delay);

                    // Auto scroll
                    const chatBody = document.getElementById('chat-body');
                    if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
                } else {
                    if (btnBackChat) btnBackChat.style.display = 'flex';
                }
            }

            typeNextChar();
        }
    }

    // ── Back to Questions ──
    if (btnBackChat) {
        btnBackChat.addEventListener('click', () => {
            clearTimeout(typeWriterTimeout);
            if (activeView) activeView.classList.remove('show');
            faqListEl.style.display = 'flex';
        });
    }

    // ── Drag to Move (via chat-header or toggle button) ──
    initDrag();

    function initDrag() {
        const container = document.querySelector('.chat-container');
        const header = document.querySelector('.chat-header');
        if (!container) return;

        let isDragging = false;
        let hasMoved = false;
        let startX, startY, origLeft, origBottom;
        const DRAG_THRESHOLD = 5; // pixels before treating as drag

        function beginDrag(e) {
            const rect = container.getBoundingClientRect();
            origLeft = rect.left;
            origBottom = window.innerHeight - rect.bottom;
            startX = e.clientX;
            startY = e.clientY;
            isDragging = true;
            hasMoved = false;

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        }

        function onPointerMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Start visual drag only after threshold
            if (!hasMoved && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
            hasMoved = true;
            container.classList.add('dragging');

            let newLeft = origLeft + dx;
            let newBottom = origBottom - dy;

            // Clamp within viewport
            const rect = container.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
            newBottom = Math.max(0, Math.min(newBottom, window.innerHeight - h));

            container.style.left = newLeft + 'px';
            container.style.bottom = newBottom + 'px';
            container.style.right = 'auto';
            container.style.top = 'auto';
        }

        function onPointerUp() {
            isDragging = false;
            container.classList.remove('dragging');
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
        }

        // Drag from header (when panel is open)
        if (header) {
            header.addEventListener('pointerdown', (e) => {
                if (e.target.closest('button')) return;
                beginDrag(e);
                e.preventDefault();
            });
        }

        // Drag from toggle button — drag on move, click on tap
        if (chatToggleBtn) {
            chatToggleBtn.addEventListener('pointerdown', (e) => {
                beginDrag(e);
                // Don't preventDefault — let click still fire if no drag
            });

            // Suppress click if user dragged
            chatToggleBtn.addEventListener('click', (e) => {
                if (hasMoved) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    hasMoved = false;
                }
            }, true);
        }
    }
})();
