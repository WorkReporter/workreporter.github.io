// js/date-picker-init.js
// אתחול flatpickr לכל שדות התאריך — פורמט ישראלי dd/mm/yyyy
// הקובץ נטען כ-global script (לא module) כדי לתפוס גם אלמנטים דינמיים

(function () {
    'use strict';

    var FP_MOBILE_MQ = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 768px)')
        : { matches: false };

    function isMobilePickerLayout() {
        return FP_MOBILE_MQ.matches;
    }

    var fpBackdropLocks = 0;
    var fpScrollLocks = 0;

    function ensureFpBackdrop() {
        var el = document.getElementById('fp-cal-backdrop');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fp-cal-backdrop';
            el.className = 'fp-cal-backdrop';
            el.setAttribute('aria-hidden', 'true');
            el.addEventListener('click', function () {
                document.querySelectorAll('input.flatpickr-input').forEach(function (inp) {
                    if (inp._flatpickr) {
                        inp._flatpickr.close();
                    }
                });
            });
            document.body.appendChild(el);
        }
        return el;
    }

    function fpBackdropAcquire() {
        fpBackdropLocks += 1;
        if (fpBackdropLocks === 1) {
            ensureFpBackdrop().classList.add('fp-cal-backdrop--active');
        }
    }

    function fpBackdropRelease() {
        fpBackdropLocks = Math.max(0, fpBackdropLocks - 1);
        if (fpBackdropLocks === 0) {
            var el = document.getElementById('fp-cal-backdrop');
            if (el) {
                el.classList.remove('fp-cal-backdrop--active');
            }
        }
    }

    function bodyScrollLockAcquire() {
        fpScrollLocks += 1;
        if (fpScrollLocks === 1) {
            document.documentElement.classList.add('fp-cal-scroll-lock');
            document.body.classList.add('fp-cal-scroll-lock');
        }
    }

    function bodyScrollLockRelease() {
        fpScrollLocks = Math.max(0, fpScrollLocks - 1);
        if (fpScrollLocks === 0) {
            document.documentElement.classList.remove('fp-cal-scroll-lock');
            document.body.classList.remove('fp-cal-scroll-lock');
        }
    }

    /** שומר את הלוח בתוך המסגרת בדסקטופ (אחרי חישוב המיקום של flatpickr) */
    function clampCalendarToViewport(instance) {
        if (isMobilePickerLayout()) {
            return;
        }
        var cal = instance.calendarContainer;
        if (!cal || !cal.classList.contains('open')) {
            return;
        }
        var rect = cal.getBoundingClientRect();
        var margin = 10;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var top = rect.top;
        var left = rect.left;

        if (rect.right > vw - margin) {
            left += vw - margin - rect.right;
        }
        if (left < margin) {
            left = margin;
        }
        if (rect.bottom > vh - margin) {
            top += vh - margin - rect.bottom;
        }
        if (top < margin) {
            top = margin;
        }

        cal.style.top = top + 'px';
        cal.style.left = left + 'px';
    }

    function onFlatpickrOpen(selectedDates, dateStr, instance) {
        instance._fpUsedMobileChrome = isMobilePickerLayout();
        if (instance._fpUsedMobileChrome) {
            fpBackdropAcquire();
            bodyScrollLockAcquire();
            instance.calendarContainer.classList.add('fp-calendar--mobile');
        } else {
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    clampCalendarToViewport(instance);
                });
            });
        }
    }

    function onFlatpickrClose(selectedDates, dateStr, instance) {
        if (instance && instance._fpUsedMobileChrome) {
            fpBackdropRelease();
            bodyScrollLockRelease();
            instance._fpUsedMobileChrome = false;
        }
        if (instance && instance.calendarContainer) {
            instance.calendarContainer.classList.remove('fp-calendar--mobile');
        }
    }

    const FLATPICKR_CONFIG = {
        dateFormat: 'Y-m-d',      // הערך שנשמר (ISO — תואם ל-DB)
        altInput: true,            // שדה תצוגה נפרד
        altFormat: 'd/m/Y',       // הפורמט שהמשתמש רואה
        locale: 'he',
        allowInput: true,
        disableMobile: true,       // תמיד להשתמש ב-flatpickr גם במובייל
        appendTo: document.body,   // מעל מודאלים וללא חיתוך מ-overflow
        onOpen: onFlatpickrOpen,
        onClose: onFlatpickrClose,
        onReady: function(selectedDates, dateStr, instance) {
            // הוספת פוטר עם כפתורי קיצור אם הוא לא קיים עדיין
            if (!instance.calendarContainer.querySelector('.fp-footer')) {
                const footer = document.createElement('div');
                footer.className = 'fp-footer';

                // כפתור "היום"
                const todayBtn = document.createElement('button');
                todayBtn.className = 'fp-btn fp-btn-today';
                todayBtn.type = 'button';
                todayBtn.innerText = 'היום';
                todayBtn.addEventListener('click', () => {
                    instance.setDate(new Date());
                    instance.close();
                });

                // כפתור "נקה"
                const clearBtn = document.createElement('button');
                clearBtn.className = 'fp-btn fp-btn-clear';
                clearBtn.type = 'button';
                clearBtn.innerText = 'נקה';
                clearBtn.addEventListener('click', () => {
                    instance.clear();
                    instance.close();
                });

                footer.appendChild(todayBtn);
                footer.appendChild(clearBtn);
                instance.calendarContainer.appendChild(footer);
            }
        }
    };

    // שמור reference ל-setter המקורי של input.value
    const nativeValueDescriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
    );

    /**
     * הפעלת flatpickr על אלמנט date שלא אותחל עדיין
     */
    function initDateInput(input) {
        // אם כבר אותחל — דלג
        if (input._flatpickr || input.dataset.fpInited) return;
        input.dataset.fpInited = 'true';

        // שמור ערך קיים ו-class מקורי
        const existingValue = input.value;
        const originalClass = input.className;

        // שנה ל-text כדי ש-flatpickr יעבוד על השדה
        input.type = 'text';

        const fp = flatpickr(input, {
            ...FLATPICKR_CONFIG,
            altInputClass: originalClass + ' flatpickr-alt-input',
            defaultDate: existingValue || null
        });

        // Monkey-patch .value setter כדי ש-input.value = '2026-04-03'
        // גם יעדכן את התצוגה של flatpickr
        Object.defineProperty(input, 'value', {
            get: function () {
                return nativeValueDescriptor.get.call(this);
            },
            set: function (val) {
                nativeValueDescriptor.set.call(this, val);
                // guard נגד אינסוף רקורסיה — flatpickr.setDate קורא ל-value= פנימית
                if (!this._fpSetting && this._flatpickr) {
                    this._fpSetting = true;
                    try {
                        this._flatpickr.setDate(val, false);
                    } finally {
                        this._fpSetting = false;
                    }
                }
            },
            configurable: true
        });

        return fp;
    }

    /**
     * סריקה ואתחול כל שדות ה-date שלא אותחלו
     */
    function initAllDateInputs() {
        document.querySelectorAll('input[type="date"]:not([data-fp-inited])').forEach(initDateInput);
    }

    // אתחול ראשוני ברגע ש-DOM מוכן
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAllDateInputs);
    } else {
        initAllDateInputs();
    }

    // MutationObserver — מאזין לאלמנטים דינמיים שנוספים ל-DOM
    const observer = new MutationObserver(function (mutations) {
        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                hasNewNodes = true;
                break;
            }
        }
        if (hasNewNodes) {
            // קצת debounce כדי לא לקרוא יותר מדי
            clearTimeout(observer._timer);
            observer._timer = setTimeout(initAllDateInputs, 50);
        }
    });

    // צפייה בכל ה-DOM
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // חשוף פונקציה גלובלית למקרה שצריך אתחול ידני
    window.initDateInputs = initAllDateInputs;
    window.initSingleDateInput = initDateInput;
})();
