// Core app logic (auth, screens, reports, calendar, user flows)

(function () {
    const { firebaseConfig, hoursPerDay, defaultResearchers } = window.APP_CONFIG;

    // Initialize Firebase (idempotent)
    if (!window._firebaseInitialized) {
        firebase.initializeApp(firebaseConfig);
        window._firebaseInitialized = true;
    }
    // Email verification disabled per user request; keep domain restriction only

    async function sendVerificationSafe() { /* no-op */ }


    // Expose auth and database to other modules
    const auth = firebase.auth();
    const database = firebase.database();
    window.auth = auth;
    window.database = database;

    // Persistent login
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    // App state
    let currentUser = null;
    let isAdmin = false;
    let activeResearchers = [];
    let allResearchers = [];
    let reports = [];
    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();
    let selectedDate = null;
    let currentWeek = getCurrentWeek();
    let activeResearchersRef = null; // live subscription ref for cleanup

    // Expose for admin module and UI
    window.getAppState = function () {
        return { currentUser, isAdmin, activeResearchers, allResearchers, reports, currentMonth, currentYear, selectedDate, currentWeek };
    };
    window.setIsAdmin = function (v) { isAdmin = v; updateAdminUI(); };

    // ---------- Auth Flow ----------
    function init() {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                // Detect admin without exposing email: try privileged read allowed only to admin by rules
                isAdmin = false;
                setAuthUIState(true);
                initializeDates();
                Promise.all([
                    ensureGlobalResearchersSeed(),
                    loadUserProfile(user.uid),
                    loadActiveResearchers(user.uid),
                    loadReports(user.uid)
                ]).then(async () => {
                    // Merge user-specific researchers with global list after loading
                    await mergeUserSpecificResearchers(user.uid);

                    try {
                        // admin check by attempting to read an admin-only path (e.g., users root)
                        await window.database.ref('users').once('value');
                        isAdmin = true;
                    } catch (_) {
                        isAdmin = false;
                    }
                    updateAdminUI();
                    updateNotifications();
                    // After first verified login, ensure profile doc exists
                    if (currentUser && currentUser.uid) {
                        const userRef = database.ref('users/' + currentUser.uid);
                        const snap = await userRef.once('value');
                        if (!snap.exists()) {
                            const email = currentUser.email || '';
                            await userRef.set({ firstName: '', lastName: '', position: '', email, createdAt: new Date().toISOString() }).catch(() => {});
                        }
                    }
                    if (isAdmin) {
                        window.location.href = '/admin-dashboard/manager_dashboard.html';
                    } else {
                        showScreen('main');
                    }
                }).catch(async () => {
                    // Even on partial failures, route admins to admin dashboard for convenience
                    try {
                        await window.database.ref('users').once('value');
                        isAdmin = true;
                    } catch (_) {
                        isAdmin = false;
                    }
                    if (isAdmin) {
                        window.location.href = '/admin-dashboard/manager_dashboard.html';
                    } else {
                        showScreen('main');
                    }
                });
            } else {
                // cleanup listeners on sign-out
                if (activeResearchersRef) { activeResearchersRef.off(); activeResearchersRef = null; }
                currentUser = null;
                isAdmin = false;
                reports = [];
                setAuthUIState(false);
                showScreen('login');
            }
        });
    }

    function setAuthUIState(isLoggedIn) {
        const nav = document.querySelector('.navigation');
        const logoutBtn = document.getElementById('logout-btn');
        if (isLoggedIn) {
            if (nav) nav.style.display = '';
            if (logoutBtn) logoutBtn.style.display = '';
        } else {
            if (nav) nav.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
        }
    }

    function showScreen(screenName) {
        if (!currentUser && screenName !== 'login') {
            screenName = 'login';
        }
        const screens = ['login', 'main', 'user-profile', 'active-researchers', 'calendar', 'reports', 'daily-report', 'admin', 'about'];
        screens.forEach(screen => {
            const el = document.getElementById(screen + '-screen');
            if (el) el.classList.add('hidden');
        });
        const target = document.getElementById(screenName + '-screen');
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`.nav-btn[onclick="showScreen('${screenName}')"]`);
        if (btn) btn.classList.add('active');

        if (screenName === 'calendar') { renderCalendar(); const addBtnCalendar = document.querySelector('#calendar-screen .btn.add'); if (addBtnCalendar && addBtnCalendar.style) addBtnCalendar.style.display = ''; }
        if (screenName === 'reports') {
            // Always fetch the latest reports from Firebase when opening the reports screen
            initializeReportScreen();
            if (currentUser && currentUser.uid) {
                database.ref('reports/' + currentUser.uid).once('value').then(snapshot => {
                    const data = snapshot.val();
                    reports = data ? Object.values(data) : [];
                    // Ensure UI is updated with freshest data
                    try { generateReport(); } catch (e) { /* generateReport defined later; safe to ignore if not yet available */ }
                }).catch(() => {
                    // On failure just attempt to render with current in-memory reports
                    try { generateReport(); } catch (e) {}
                });
            } else {
                // No user - still initialize UI
                try { generateReport(); } catch (e) {}
            }
        }
        if (screenName === 'active-researchers') renderResearchers();
        if (screenName === 'main') updateNotifications();
        if (screenName === 'admin') initializeAdminScreen();
    }

    // Basic XSS protection utility available globally
    window.escapeHtml = function (unsafe) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(unsafe ?? '')));
        return div.innerHTML;
    };

    window.showScreen = showScreen;

    function logout() {
        auth.signOut().catch(() => {}).finally(() => {
            if (activeResearchersRef) { activeResearchersRef.off(); activeResearchersRef = null; }
            currentUser = null;
            isAdmin = false;
            reports = [];
            updateAdminUI();
            setAuthUIState(false);
            showScreen('login');
        });
    }
    window.logout = logout;

    // ---------- Firebase: Users / Researchers ----------
    async function ensureGlobalResearchersSeed() {
        try {
            // First try to load from JSON file
            const response = await fetch('/assets/researchers.json');
            if (response.ok) {
                const data = await response.json();
                if (data.researchers && Array.isArray(data.researchers) && data.researchers.length > 0) {
                    allResearchers = data.researchers;
                    // Update Firebase with the JSON data
                    await database.ref('global/researchers').set(data.researchers);
                    return;
                }
            }
        } catch (error) {
            console.log('Could not load researchers from JSON, using Firebase fallback');
        }

        // Fallback to Firebase
        return database.ref('global/researchers').once('value').then(snap => {
            let list = snap.val();
            if (!Array.isArray(list) || list.length === 0) {
                list = defaultResearchers;
                return database.ref('global/researchers').set(list).then(() => {
                    allResearchers = list;
                });
            }
            allResearchers = list;
        });
    }

    /**
     * מרגה חוקרים מותאמים אישית מהרשימה הפעילה של המשתמש עם הרשימה הגלובלית
     * @param {string} uid מזהה המשתמש
     */
    async function mergeUserSpecificResearchers(uid) {
        if (!uid || !Array.isArray(activeResearchers)) return;

        // מוצא חוקרים שקיימים ברשימה הפעילה אבל לא ברשימה הגלובלית
        const userSpecificResearchers = activeResearchers.filter(researcher =>
            researcher &&
            researcher !== 'משימות אחרות' &&
            researcher !== 'סמינר / קורס / הכשרה' &&
            !allResearchers.includes(researcher)
        );

        // מוסיף את החוקרים המותאמים אישית לרשימה הגלובלית המקומית
        if (userSpecificResearchers.length > 0) {
            allResearchers = [...allResearchers, ...userSpecificResearchers];
            console.log(`Merged ${userSpecificResearchers.length} user-specific researchers:`, userSpecificResearchers);
        }
    }

    function loadUserProfile(uid) {
        return database.ref('users/' + uid).once('value').then((snapshot) => {
            const userData = snapshot.val() || {};
            setInputValue('profile-first-name', userData.firstName || '');
            setInputValue('profile-last-name', userData.lastName || '');
            setInputValue('profile-position', userData.position || '');
            setInputValue('profile-email', userData.email || (currentUser ? currentUser.email : ''));
            const profileMgr = document.getElementById('profile-my-manager');
            if (profileMgr) {
                // אם יש כבר שדות מפורקים השתמש בהם להרכבת הערך
                if (userData.my_manager_email && userData.my_manager_fullName) {
                    profileMgr.value = `${userData.my_manager_fullName}|${userData.my_manager_email}`;
                } else {
                    profileMgr.value = userData.my_manager || '';
                }
            }
            // Update manager field visibility according to role
            if (typeof updateManagerUIVisibility === 'function') {
                updateManagerUIVisibility(userData.position || '');
            }
        }).catch(() => {});
    }

    function updateUserProfile(uid, data) {
        return database.ref('users/' + uid).update(data);
    }
    window.updateUserProfile = (uid, data) => updateUserProfile(uid, data);

    function loadActiveResearchers(uid) {
        if (!uid) return Promise.resolve();
        // Clean previous listener if any
        if (activeResearchersRef) { activeResearchersRef.off(); activeResearchersRef = null; }
        activeResearchersRef = database.ref('users/' + uid + '/activeResearchers');
        return new Promise((resolve) => {
            activeResearchersRef.on('value', async snap => {
                const data = snap.val();
                if (Array.isArray(data) && data.length > 0) {
                    activeResearchers = data;
                } else {
                    // אם אין חוקרים פעילים נבחרים, השאר את הרשימה ריקה
                    activeResearchers = [];
                }

                // מזג חוקרים מותאמים אישית עם הרש lista הגלובלית
                await mergeUserSpecificResearchers(uid);

                // If relevant screens are open, re-render
                const isDailyReportOpen = !document.getElementById('daily-report-screen')?.classList.contains('hidden');
                if (isDailyReportOpen) { refreshResearcherDropdowns(); }
                const isActiveResearchersOpen = !document.getElementById('active-researchers-screen')?.classList.contains('hidden');
                if (isActiveResearchersOpen) { renderResearchers(); }
                resolve();
            }, () => resolve());
        });
    }

    // ---------- Reports ----------
    function loadReports(uid) {
        if (!uid) return Promise.resolve();
        return new Promise((resolve) => {
            database.ref('reports/' + uid).on('value', (snapshot) => {
                const data = snapshot.val();
                reports = data ? Object.values(data) : [];
                if (!document.getElementById('calendar-screen')?.classList.contains('hidden')) {
                    renderCalendar();
                }
                resolve();
            });
        });
    }

    // ---------- Report Validation Functions (דרישה: הגבלות זמן לדיווח) ----------

    /**
     * בודק אם תאריך נמצא באותו השבוע של היום
     * @param {Date} date התאריך לבדיקה
     * @returns {boolean} האם התאריך באותו השבוע
     */
    function isInCurrentWeek(date) {
        const today = new Date();
        const currentWeekStart = getSundayOfWeek(today);
        const currentWeekEnd = new Date(currentWeekStart);
        currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
        // Reset time to avoid time comparison issues
        const checkDate = new Date(date);
        checkDate.setHours(0, 0, 0, 0);
        currentWeekStart.setHours(0, 0, 0, 0);
        currentWeekEnd.setHours(0, 0, 0, 0);
        return checkDate >= currentWeekStart && checkDate <= currentWeekEnd;
    }

    /**
     * בודק אם תאריך נמצא בשבוע הקודם
     * @param {Date} date התאריך לבדיקה
     * @returns {boolean} האם התאריך בשבוע הקודם
     */
    function isInPreviousWeek(date) {
        const today = new Date();
        const currentWeekStart = getSundayOfWeek(today);
        const previousWeekStart = new Date(currentWeekStart);
        previousWeekStart.setDate(currentWeekStart.getDate() - 7);
        const previousWeekEnd = new Date(previousWeekStart);
        previousWeekEnd.setDate(previousWeekStart.getDate() + 6);

        // Reset time to avoid time comparison issues
        const checkDate = new Date(date);
        checkDate.setHours(0, 0, 0, 0);
        previousWeekStart.setHours(0, 0, 0, 0);
        previousWeekEnd.setHours(0, 0, 0, 0);

        return checkDate >= previousWeekStart && checkDate <= previousWeekEnd;
    }

    /**
     * בודק אם תאריך מכוסה על ידי דיווח שבועי או יש דיוח יומי לאותו תאריך
     * @param {string} dateString התאריך בפורמט YYYY-MM-DD
     * @param {Array} reports רשימת הדיווחים
     * @returns {boolean} האם התאריך מכוסה על ידי דיווח
     */
    function isDateCoveredByWeeklyReport(dateString, reports) {
        const checkDate = new Date(dateString);
        checkDate.setHours(0, 0, 0, 0);

        return reports.some(report => {
            if (report.type !== 'weekly') return false;

            // Parse the weekly report date range from the key or stored data
            let weekStart, weekEnd;

            // Try to get dates from the report key (format: weekly_YYYY-MM-DD_YYYY-MM-DD)
            if (report.key && report.key.startsWith('weekly_')) {
                const datesPart = report.key.replace('weekly_', '');
                const [startStr, endStr] = datesPart.split('_');
                if (startStr && endStr) {
                    weekStart = new Date(startStr);
                    weekEnd = new Date(endStr);
                }
            }

            // If we couldn't get dates from key, try from stored weekStart/weekEnd
            if (!weekStart && report.weekStart) {
                weekStart = new Date(report.weekStart);
            }
            if (!weekEnd && report.weekEnd) {
                weekEnd = new Date(report.weekEnd);
            }

            // If still no dates, try to parse from week field (format: "DD/MM/YYYY - DD/MM/YYYY")
            if (!weekStart && report.week) {
                const weekParts = report.week.split(' - ');
                if (weekParts.length === 2) {
                    const [startPart, endPart] = weekParts;
                    const [startDay, startMonth, startYear] = startPart.split('/');
                    const [endDay, endMonth, endYear] = endPart.split('/');
                    weekStart = new Date(startYear, startMonth - 1, startDay);
                    weekEnd = new Date(endYear, endMonth - 1, endDay);
                }
            }

            if (!weekStart || !weekEnd) return false;

            // Reset time to avoid time comparison issues
            weekStart.setHours(0, 0, 0, 0);
            weekEnd.setHours(23, 59, 59, 999);

            // Check if the date falls within the weekly report range (Sunday to Thursday)
            return checkDate >= weekStart && checkDate <= weekEnd;
        });
    }

    /**
     * בודק אם יש דיווח (יומי או שבועי) לתאריך נתון
     * @param {string} dateString התאריך בפורמט YYYY-MM-DD
     * @param {Array} reports רשימת הדיווחים
     * @returns {Object} תוצאה עם hasReport (boolean) ו reportType (string)
     */
    function hasReportForDate(dateString, reports) {
        // בודק דיווח יומי ישיר
        const hasDailyReport = reports.some(r => r.type === 'daily' && r.date === dateString);
        if (hasDailyReport) {
            return { hasReport: true, reportType: 'daily' };
        }

        // בודק אם התאריך מכוסה על ידי דיווח שבועי
        const isCoveredByWeekly = isDateCoveredByWeeklyReport(dateString, reports);
        if (isCoveredByWeekly) {
            return { hasReport: true, reportType: 'weekly' };
        }

        return { hasReport: false, reportType: null };
    }

    // =================================================================
    // NEW FUNCTION
    // =================================================================
    /**
     * מוצא את הדיווח המלא (יומי או שבועי) לתאריך נתון
     * @param {string} dateString התאריך בפורמט YYYY-MM-DD
     * @returns {Object|null} אובייקט הדיווח או null אם לא נמצא
     */
    function findReportForDate(dateString) {
        // חיפוש דיווח יומי ישיר
        const dailyReport = reports.find(r => r.type === 'daily' && r.date === dateString);
        if (dailyReport) {
            return dailyReport;
        }

        // חיפוש דיווח שבועי שמכסה את התאריך
        const weeklyReport = reports.find(report => {
            if (report.type !== 'weekly') return false;

            let weekStart, weekEnd;
            if (report.weekStart && report.weekEnd) {
                weekStart = new Date(report.weekStart);
                weekEnd = new Date(report.weekEnd);
            } else if (report.week) {
                const weekParts = report.week.split(' - ');
                if (weekParts.length === 2) {
                    const [startPart, endPart] = weekParts;
                    const [startDay, startMonth, startYear] = startPart.split('/');
                    const [endDay, endMonth, endYear] = endPart.split('/');
                    weekStart = new Date(startYear, startMonth - 1, startDay);
                    weekEnd = new Date(endYear, endMonth - 1, endDay);
                }
            }

            if (!weekStart || !weekEnd) return false;

            const checkDate = new Date(dateString);
            checkDate.setHours(0, 0, 0, 0);
            weekStart.setHours(0, 0, 0, 0);
            weekEnd.setHours(23, 59, 59, 999);

            return checkDate >= weekStart && checkDate <= weekEnd;
        });

        return weeklyReport || null;
    }
    // =================================================================
    // END NEW FUNCTION
    // =================================================================

    /**
     * בודק אם מותר ליצור דיווח חדש לתאריך נתון
     * דרישה: לתת להוסיף דיווח חדש שבוע אחורה אבל לא יותר
     * @param {Date} date התאריך לבדיקה
     * @returns {Object} תוצאה עם allowed (boolean) ו message (string)
     */
    function canCreateNewReport(date) {
        // DEBUG: הוספת לוגים לבדיקה
        const today = new Date();
        console.log('DEBUG canCreateNewReport:');
        console.log('  Today:', today.toDateString());
        console.log('  Date to check:', date.toDateString());

        // בדיקת תאריך עתידי - אסור לדווח על תאריכים עתידיים
        const todayOnly = new Date(today);
        todayOnly.setHours(0, 0, 0, 0);
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);

        if (dateOnly > todayOnly) {
            console.log('  Future date detected - not allowed');
            return {
                allowed: false,
                message: 'לא ניתן לדווח על תאריכים עתידיים'
            };
        }

        const currentWeekStart = getSundayOfWeek(today);
        const currentWeekEnd = new Date(currentWeekStart);
        currentWeekEnd.setDate(currentWeekStart.getDate() + 6);

        const previousWeekStart = new Date(currentWeekStart);
        previousWeekStart.setDate(currentWeekStart.getDate() - 7);
        const previousWeekEnd = new Date(previousWeekStart);
        previousWeekEnd.setDate(previousWeekStart.getDate() + 6);

        console.log('  Current week:', currentWeekStart.toDateString(), '-', currentWeekEnd.toDateString());
        console.log('  Previous week:', previousWeekStart.toDateString(), '-', previousWeekEnd.toDateString());

        // Allow reporting for current week (Sunday-Thursday) but only for past/today dates
        const inCurrentWeek = isInCurrentWeek(date);
        console.log('  In current week?', inCurrentWeek);
        if (inCurrentWeek) {
            return { allowed: true, message: '' };
        }

        // Allow reporting for previous week (Sunday-Thursday) - NEW REPORTS ONLY
        const inPreviousWeek = isInPreviousWeek(date);
        console.log('  In previous week?', inPreviousWeek);
        if (inPreviousWeek) {
            // בדיקה נוספת: אם יש כבר דיווח שבועי לאותו שבוע, לא מאפשרים דיווח יומי חדש
            const dateString = formatDate(date);
            const existingWeeklyReport = isDateCoveredByWeeklyReport(dateString, reports);
            if (existingWeeklyReport) {
                return {
                    allowed: false,
                    message: 'לא ניתן ליצור דיווח יומי - קיים כבר דיווח שבועי לאותו שבוע'
                };
            }
            return { allowed: true, message: 'דיווח לשבוע קודם - ניתן רק להוסיף דיווח חדש' };
        }

        // For any other dates - not allowed
        const daysDiff = Math.floor((today - date) / (1000 * 60 * 60 * 24));
        console.log('  Days difference:', daysDiff);

        if (daysDiff < 0) {
            return {
                allowed: false,
                message: 'לא ניתן לדווח על תאריכים עתידיים'
            };
        }

        return {
            allowed: false,
            message: 'לא ניתן לדווח יותר משבוע אחורה'
        };
    }

    /**
     * בודק אם מותר לערוך דיווח קיים
     * דרישה: עריכת דיווחים רק של אותו שבוע (השבוע הנוכחי)
     * @param {Date} date התאריך של הדיווח
     * @returns {Object} תוצאה עם allowed (boolean) ו message (string)
     */
    function canEditExistingReport(date) {
        // Only allow editing reports from current week
        if (isInCurrentWeek(date)) {
            return { allowed: true, message: '' };
        }

        // בדיקה מיוחדת: אם יש דיווח שבועי לתאריך הזה, אז זה אסור לעריכה
        const dateString = formatDate(date);
        const reportInfo = hasReportForDate(dateString, reports);

        if (reportInfo.hasReport && reportInfo.reportType === 'weekly') {
            return {
                allowed: false,
                message: 'לא ניתן לערוך דיווח שבועי מהשבוע הקודם'
            };
        }

        return {
            allowed: false,
            message: 'לא ניתן לערוך דיווח קיים מהשבוע הקודם - רק ליצור חדש'
        };
    }

    /**
     * בודק אם יש התנגשות בין דיווח יומי לשבועי באותו שבוע
     * @param {Date} date התאריך שרוצים לדווח עליו
     * @param {string} reportType סוג הדיווח שרוצים ליצור ('daily' או 'weekly')
     * @returns {Object} תוצאה עם allowed (boolean) ו message (string)
     */
    function checkReportTypeConflict(date, reportType) {
        const sunday = getSundayOfWeek(date);
        const thursday = new Date(sunday);
        thursday.setDate(sunday.getDate() + 4);

        // מצא את כל הדיווחים באותו שבוע
        const weekReports = reports.filter(report => {
            if (report.type === 'weekly') {
                // בדיקת דיווח שבועי
                let reportWeekStart, reportWeekEnd;

                if (report.weekStart && report.weekEnd) {
                    reportWeekStart = new Date(report.weekStart);
                    reportWeekEnd = new Date(report.weekEnd);
                } else if (report.week) {
                    const weekParts = report.week.split(' - ');
                    if (weekParts.length === 2) {
                        const [startPart, endPart] = weekParts;
                        const [startDay, startMonth, startYear] = startPart.split('/');
                        const [endDay, endMonth, endYear] = endPart.split('/');
                        reportWeekStart = new Date(startYear, startMonth - 1, startDay);
                        reportWeekEnd = new Date(endYear, endMonth - 1, endDay);
                    }
                }

                if (reportWeekStart && reportWeekEnd) {
                    // בדוק אם השבוע של התאריך חופף עם השבוע של הדיווח
                    return (sunday.getTime() === reportWeekStart.getTime() &&
                            thursday.getTime() === reportWeekEnd.getTime());
                }
            } else if (report.type === 'daily' && report.date) {
                // בדיקת דיווח יומי - האם הוא באותו שבוע
                const [year, month, day] = report.date.split('-').map(Number);
                const reportDate = new Date(year, month - 1, day);
                const reportSunday = getSundayOfWeek(reportDate);
                return reportSunday.getTime() === sunday.getTime();
            }

            return false;
        });

        // בדוק התנגשויות
        const hasWeeklyReport = weekReports.some(r => r.type === 'weekly');
        const hasDailyReport = weekReports.some(r => r.type === 'daily');

        if (reportType === 'weekly' && hasDailyReport) {
            return {
                allowed: false,
                message: 'לא ניתן ליצור דיווח שבועי - קיימים כבר דיווחים יומיים באותו שבוע'
            };
        }

        if (reportType === 'daily' && hasWeeklyReport) {
            return {
                allowed: false,
                message: 'לא ניתן ליצור דיווח יומי - קיים כבר דיווח שבועי לאותו שבוע'
            };
        }

        return { allowed: true, message: '' };
    }

    function submitReport() {
        const reportDate = getInputValue('report-date');
        if (!reportDate) { showError('אנא הזן תאריך'); return; }

        // Create date in local timezone to avoid timezone issues
        const [year, month, day] = reportDate.split('-').map(Number);
        const selectedDate = new Date(year, month - 1, day);

        // בדיקת תאריך עתידי - אסור לדווח על תאריכים עתידיים
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset time to midnight for accurate date comparison
        const selectedDateOnly = new Date(selectedDate);
        selectedDateOnly.setHours(0, 0, 0, 0);

        if (selectedDateOnly > today) {
            showError('לא ניתן לדווח על תאריכים עתידיים');
            return;
        }

        // דרישה: לא לאפשר דיוח עבודה בימי שישי שבת
        if (selectedDate.getDay() === 5 || selectedDate.getDay() === 6) {
            showError('לא ניתן לדווח עבודה בימי שישי ושבת');
            return;
        }

        // בדיקה אם יש דיווח קיים לתאריך הזה (יומי או שבועי)
        const reportInfo = hasReportForDate(reportDate, reports);

        if (reportInfo.hasReport) {
            // יש דיווח קיים - בודק אם ניתן לערוך
            const editValidation = canEditExistingReport(selectedDate);
            if (!editValidation.allowed) {
                showError(editValidation.message);
                return;
            }
        } else {
            // אין דיוח - בודק אם ניתן ליצור חדש
            const createValidation = canCreateNewReport(selectedDate);
            if (!createValidation.allowed) {
                showError(createValidation.message);
                return;
            }
        }

        const isWeekly = document.getElementById('daily-form').classList.contains('hidden');

        // בדיקת התנגשות בין סוגי דיווחים לפני שמירה
        const conflictCheck = checkReportTypeConflict(selectedDate, isWeekly ? 'weekly' : 'daily');
        if (!conflictCheck.allowed) {
            showError(conflictCheck.message);
            return;
        }

        const reportData = {
            date: reportDate,
            type: isWeekly ? 'weekly' : 'daily',
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            entries: []
        };

        if (!isWeekly) {
            // דרישה: דיווח יומי-שעתי
            const workStatus = document.querySelector('#work-status-toggle .toggle-option.active')?.dataset.status || 'worked';
            reportData.workStatus = workStatus;

            if (workStatus === 'worked') {
                // Collect valid entries and validate them
                const validEntries = [];
                let hasValidationErrors = false;
                let errorMessage = '';

                document.querySelectorAll('#work-entries .work-entry').forEach((entry, index) => {
                    const researcher = entry.querySelector('.researcher-select')?.value || '';
                    const hours = parseFloat(entry.querySelector('.hours-input')?.value || '0') || 0;
                    const detail = (entry.querySelector('textarea')?.value || '').trim();

                    // Skip empty entries (no researcher selected)
                    if (!researcher) return;

                    // Validate hours > 0
                    if (hours <= 0) {
                        hasValidationErrors = true;
                        errorMessage = `שורה ${index + 1}: חייב להזין מספר שעות גדול מ-0`;
                        return;
                    }

                    // Validate required details for specific researcher types
                    if ((researcher === 'משימות אחרות' || researcher === 'סמינר / קורס / הכשרה') && !detail) {
                        hasValidationErrors = true;
                        errorMessage = `שורה ${index + 1}: חייב להוסיף פירוט עבור "${researcher}"`;
                        return;
                    }

                    validEntries.push({ researcher, hours, detail });
                });

                // Check for validation errors
                if (hasValidationErrors) {
                    showError(errorMessage);
                    return;
                }

                // Check if no valid entries with hours
                if (validEntries.length === 0) {
                    showError('חייב להזין לפחות חוקר אחד עם מספר שעות גדול מ-0');
                    return;
                }

                reportData.entries = validEntries;
            }
        } else {
            // דרישה: דיווח שבועי - הגעה אליו ביום ה' בלבד
            const today = new Date();
            if (today.getDay() !== 4) {
                showError('דיווח שבועי זמין רק בימי חמישי');
                return;
            }

            const week = getInputValue('report-week');
            reportData.week = week;
            const weeklyEntries = [];
            let hasValidationErrors = false;
            let errorMessage = '';

            document.querySelectorAll('#weekly-entries .work-entry').forEach((entry, index) => {
                const researcher = entry.querySelector('.researcher-select')?.value || '';
                const days = parseFloat(entry.querySelector('.days-input')?.value || '0') || 0;
                const detail = (entry.querySelector('textarea')?.value || '').trim();

                // Skip empty entries (no researcher selected)
                if (!researcher) return;

                // Validate days > 0
                if (days <= 0) {
                    hasValidationErrors = true;
                    errorMessage = `שורה ${index + 1}: חייב להזן מספר ימים גדול מ-0`;
                    return;
                }

                // Validate required details for specific researcher types
                if ((researcher === 'משימות אחרות' || researcher === 'סמינר / קורס / הכשרה') && !detail) {
                    hasValidationErrors = true;
                    errorMessage = `שורה ${index + 1}: חייב להוסיף פירוט עבור "${researcher}"`;
                    return;
                }

                weeklyEntries.push({ researcher, days, detail });
            });

            // Check for validation errors
            if (hasValidationErrors) {
                showError(errorMessage);
                return;
            }

            if (weeklyEntries.length === 0) {
                showError('אנא הזן לפחות שורה אחת לדיווח שבועי');
                return;
            }

            // Compute range for storage and filtering based on selected date, not current date
            const sunday = getSundayOfWeek(selectedDate);
            const thursday = new Date(sunday);
            thursday.setDate(sunday.getDate() + 4);
            reportData.weekStart = formatDate(sunday);
            reportData.weekEnd = formatDate(thursday);

            if (!currentUser) return;

            const weeklyKey = `weekly_${getWeekForStorageByDate(selectedDate)}`;
            database.ref('reports/' + currentUser.uid + '/' + weeklyKey).set({
                ...reportData,
                entries: weeklyEntries,
                type: 'weekly',
                timestamp: firebase.database.ServerValue.TIMESTAMP
            }).then(() => {
                showPopup('הדיווח השבועי נשמר בהצלחה!');
                setTimeout(() => {
                    showScreen('main');
                    clearReportForm();
                    loadReports(currentUser.uid);
                }, 1200);
            }).catch((error) => showError('שגיאה בשמירת הדיווח: ' + error.message));
            return;
        }

        if (!currentUser) return;
        const reportKey = isWeekly ? `weekly_${getCurrentWeekForStorage()}` : `daily_${reportData.date}`;
        database.ref('reports/' + currentUser.uid + '/' + reportKey).set(reportData).then(() => {
            showPopup('הדיווח נוסף/עודכן בהצלחה!');
            setTimeout(() => { showScreen('main'); clearReportForm(); loadReports(currentUser.uid); }, 1200);
        }).catch((error) => showError('שגיאה בשמירת הדיווח: ' + error.message));
    }
    window.submitReport = submitReport;

    function clearReportForm() {
        const workEntries = document.getElementById('work-entries');
        const weeklyEntries = document.getElementById('weekly-entries');
        if (workEntries) workEntries.innerHTML = '';
        if (weeklyEntries) weeklyEntries.innerHTML = '';
        setInputValue('total-hours', 0);
        setInputValue('total-days', 0);
    }

    // ---------- UI: Daily/Weekly Entries ----------

    // =================================================================
    // NEW FUNCTION
    // =================================================================
    /**
     * טוען נתוני דיווח קיים לתוך טופס הדיווח
     * @param {Object} report אובייקט הדיווח לטעינה
     */
    function populateReportForm(report) {
        if (!report) return;

        clearReportForm();

        // הגדרת תאריך ושדות בסיסיים. עבור דיווח שבועי, התאריך הנבחר ביומן הוא הקובע
        const reportDate = selectedDate ? formatDate(selectedDate) : (report.date || report.weekStart);
        setInputValue('report-date', reportDate);

        // עדכון כותרות וכפתורים
        const formTitle = document.querySelector('#daily-report-screen h2');
        if (formTitle) formTitle.textContent = 'עריכת דיווח קיים';
        const submitBtn = document.querySelector('#daily-report-screen .btn[onclick="submitReport()"]');
        if (submitBtn) submitBtn.textContent = 'עדכן.י דיווח';

        // בחירת סוג הדיווח
        selectReportType(report.type);

        if (report.type === 'daily') {
            const workStatus = report.workStatus || 'worked';
            selectWorkStatus(workStatus);

            if (workStatus === 'worked' && Array.isArray(report.entries)) {
                const container = document.getElementById('work-entries');
                container.innerHTML = ''; // ודא שהאזור ריק
                if (report.entries.length === 0) {
                   addWorkEntry(); // הוסף שורה ריקה אם אין נתונים
                } else {
                    report.entries.forEach(entry => {
                        addWorkEntry();
                        const newEntryEl = container.lastElementChild;
                        if (newEntryEl) {
                            const researcherSelect = newEntryEl.querySelector('.researcher-select');
                            const hoursInput = newEntryEl.querySelector('.hours-input');
                            const detailTextarea = newEntryEl.querySelector('textarea');

                            if (researcherSelect) {
                                researcherSelect.value = entry.researcher;
                                toggleDetailField(researcherSelect);
                            }
                            if (hoursInput) hoursInput.value = entry.hours;
                            if (detailTextarea) detailTextarea.value = entry.detail || '';
                        }
                    });
                }
                updateTotalHours();
            }
        } else if (report.type === 'weekly' && Array.isArray(report.entries)) {
            const container = document.getElementById('weekly-entries');
            container.innerHTML = ''; // ודא שהאזור ריק
            if (report.entries.length === 0) {
                addWeeklyEntry();
            } else {
                report.entries.forEach(entry => {
                    addWeeklyEntry();
                    const newEntryEl = container.lastElementChild;
                    if (newEntryEl) {
                        const researcherSelect = newEntryEl.querySelector('.researcher-select');
                        const daysInput = newEntryEl.querySelector('.days-input');
                        const detailTextarea = newEntryEl.querySelector('textarea');

                        if (researcherSelect) {
                            researcherSelect.value = entry.researcher;
                            toggleDetailField(researcherSelect);
                        }
                        if (daysInput) daysInput.value = entry.days;
                        if (detailTextarea) detailTextarea.value = entry.detail || '';
                    }
                });
            }
            updateTotalDays();
        }
    }
    // =================================================================
    // END NEW FUNCTION
    // =================================================================

    function addNewReport() {
        // --- MODIFIED ---: Reset UI for a new report
        const formTitle = document.querySelector('#daily-report-screen h2');
        if (formTitle) formTitle.textContent = 'דיווח חדש';
        const submitBtn = document.querySelector('#daily-report-screen .btn[onclick="submitReport()"]');
        if (submitBtn) submitBtn.textContent = 'שמירת דיווח';
        clearReportForm();

        const today = new Date();
        setInputValue('report-date', formatDate(today));
        const dayOfWeek = today.getDay();

        // Always show both options; disable weekly unless allowed (Thursday)
        const weeklyToggle = document.querySelector('#report-type-toggle .toggle-option[data-type="weekly"]');
        if (weeklyToggle) {
            const allowed = (dayOfWeek === 4);
            weeklyToggle.style.opacity = allowed ? '' : '0.5';
            weeklyToggle.setAttribute('aria-disabled', allowed ? 'false' : 'true');
            weeklyToggle.dataset.allowed = allowed ? '1' : '0';
            weeklyToggle.title = allowed ? '' : 'דיווח שבועי זמין רק בימי חמישי';
        }

        selectReportType('daily');
        showScreen('daily-report');
        // Ensure there is at least one daily entry by default
        selectWorkStatus('worked');
    }
    window.addNewReport = addNewReport;

    function selectReportType(type) {
        // בדיקת התנגשות לפני החלפת סוג הדיווח
        const reportDate = getInputValue('report-date');
        if (reportDate) {
            const [year, month, day] = reportDate.split('-').map(Number);
            const selectedDate = new Date(year, month - 1, day);

            // בדוק אם יש התנגשות עם הסוג החדש
            const conflictCheck = checkReportTypeConflict(selectedDate, type);
            if (!conflictCheck.allowed) {
                showError(conflictCheck.message);
                return; // מונע החלפת סוג הדיווח
            }
        }

        document.querySelectorAll('#report-type-toggle .toggle-option').forEach(o => o.classList.remove('active'));
        const sel = document.querySelector(`#report-type-toggle .toggle-option[data-type="${type}"]`);
        if (sel) sel.classList.add('active');
        toggleHidden('daily-form', type !== 'daily');
        toggleHidden('weekly-form', type !== 'weekly');
        if (type === 'weekly') {
            // Get the selected date to calculate the correct week range
            let weekRange;

            if (reportDate) {
                // Parse the selected date and calculate the week for that date
                const [year, month, day] = reportDate.split('-').map(Number);
                const selectedDate = new Date(year, month - 1, day);
                weekRange = getWeekForDate(selectedDate);
            } else {
                // Fallback to current week if no date is selected
                weekRange = getCurrentWeek();
            }

            setInputValue('report-week', weekRange);
            const weeklyEntries = document.getElementById('weekly-entries');
            if (weeklyEntries && weeklyEntries.children.length === 0) addWeeklyEntry();
            renderWeeklyDatesHint();
        }
    }
    window.selectReportType = selectReportType;

    function selectWorkStatus(status) {
        document.querySelectorAll('#work-status-toggle .toggle-option').forEach(o => o.classList.remove('active'));
        const sel = document.querySelector(`#work-status-toggle .toggle-option[data-status="${status}"]`);
        if (sel) sel.classList.add('active');
        const workEntries = document.getElementById('work-entries');
        if (!workEntries) return;
        if (status === 'no-work') {
            workEntries.innerHTML = '';
            workEntries.style.display = 'none';
            const addBtnDaily = document.querySelector('#daily-report-screen .btn.add');
            if (addBtnDaily && addBtnDaily.style) addBtnDaily.style.display = 'none';
            updateTotalHours();
        } else {
            workEntries.style.display = 'block';
            const addBtnDaily = document.querySelector('#daily-report-screen .btn.add');
            if (addBtnDaily && addBtnDaily.style) addBtnDaily.style.display = 'block';
            if (workEntries.children.length === 0) addWorkEntry();
        }
    }
    window.selectWorkStatus = selectWorkStatus;

    function addWorkEntry() {
        const container = document.getElementById('work-entries');
        if (!container) return;
        const entryDiv = document.createElement('div');
        entryDiv.className = 'work-entry';

        // אם אין חוקרים פעילים נבחרים, הצג רק את האפשרויות הקבועות
        let available;
        if (Array.isArray(activeResearchers) && activeResearchers.length > 0) {
            available = [...activeResearchers, 'משימות אחרות', 'סמינר / קורס / הכשרה'];
        } else {
            available = ['משימות אחרות', 'סמינר / קורס / הכשרה'];
        }

        entryDiv.innerHTML = `
            ${container.children.length > 0 ? '<button class="remove-btn" onclick="removeEntry(this)">×</button>' : ''}
            <div class="form-group">
                <label>בחר חוקר.ת/משימה:</label>
                <select class="researcher-select" onchange="toggleDetailField(this)">
                    ${available.map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
            </div>
            <div class="form-group detail-field" style="display: none;">
                <label>פרט:</label>
                <textarea rows="2" placeholder="הוספ.י פרטים נוספים..."></textarea>
            </div>
            <div class="form-group">
                <label>שעות:</label>
                <div class="number-input">
                    <button type="button" onclick="changeHours(this, -0.5)">-</button>
                    <input type="number" class="hours-input" value="0" min="0" step="0.5" onchange="updateTotalHours()">
                    <button type="button" onclick="changeHours(this, 0.5)">+</button>
                </div>
            </div>`;
        container.appendChild(entryDiv);
        updateTotalHours();
    }
    window.addWorkEntry = addWorkEntry;

    function addWeeklyEntry() {
        const container = document.getElementById('weekly-entries');
        if (!container) return;
        const entryDiv = document.createElement('div');
        entryDiv.className = 'work-entry';

        // אם אין חוקרים פעילים נבחרים, הצג רק את האפשרויות הקבועות
        let available;
        if (Array.isArray(activeResearchers) && activeResearchers.length > 0) {
            available = [...activeResearchers, 'משימות אחרות', 'סמינר / קורס / הכשרה'];
        } else {
            available = ['משימות אחרות', 'סמינר / קורס / הכשרה'];
        }

        entryDiv.innerHTML = `
            ${container.children.length > 0 ? '<button class="remove-btn" onclick="removeEntry(this)">×</button>' : ''}
            <div class="form-group">
                <label>חוקר/פרויקט:</label>
                <select class="researcher-select" onchange="toggleDetailField(this)">
                    ${available.map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
            </div>
            <div class="form-group detail-field" style="display: none;">
                <label>פרט:</label>
                <textarea rows="2" placeholder="הוספ.י פרטים נוספים..."></textarea>
            </div>
            <div class="form-group">
                <label>ימים:</label>
                <div class="number-input">
                    <button type="button" onclick="changeDays(this, -0.25)">-</button>
                    <input type="number" class="days-input" value="0" min="0" max="5" step="0.25" onchange="updateTotalDays()">
                    <button type="button" onclick="changeDays(this, 0.25)">+</button>
                </div>
            </div>`;
        container.appendChild(entryDiv);
        updateTotalDays();
    }

    function renderWeeklyDatesHint() {
        const hintEl = document.getElementById('weekly-dates-hint');
        if (!hintEl) return;

        // Get the selected date to calculate the correct week range
        const reportDate = getInputValue('report-date');
        let sunday, thursday;

        if (reportDate) {
            // Parse the selected date and calculate the week for that date
            const [year, month, day] = reportDate.split('-').map(Number);
            const selectedDate = new Date(year, month - 1, day);
            sunday = getSundayOfWeek(selectedDate);
            thursday = new Date(sunday);
            thursday.setDate(sunday.getDate() + 4);
        } else {
            // Fallback to current week if no date is selected
            const today = new Date();
            sunday = getSundayOfWeek(today);
            thursday = new Date(sunday);
            thursday.setDate(sunday.getDate() + 4);
        }

        const startDate = `${String(sunday.getDate()).padStart(2,'0')}/${String(sunday.getMonth()+1).padStart(2,'0')}/${sunday.getFullYear()}`;
        const endDate = `${String(thursday.getDate()).padStart(2,'0')}/${String(thursday.getMonth()+1).padStart(2,'0')}/${thursday.getFullYear()}`;
        hintEl.textContent = `טווח התאריכים: ${startDate} - ${endDate} (א׳–ה׳)`;
    }

    function refreshResearcherDropdowns() {
        // אם אין חוקרים פעילים נבחרים, הצג רק את האפשרויות הקבועות
        let available;
        if (Array.isArray(activeResearchers) && activeResearchers.length > 0) {
            available = [...activeResearchers, 'משימות אחרות', 'סמינר / קורס / הכשרה'];
        } else {
            available = ['משימות אחרות', 'סמינר / קורס / הכשרה'];
        }

        document.querySelectorAll('.researcher-select').forEach(sel => {
            const current = sel.value || '';
            sel.innerHTML = [...available.map(r => `<option value="${r}">${r}</option>`)].join('');
            if (current && available.includes(current)) sel.value = current;
        });
    }
    window.refreshResearcherDropdowns = refreshResearcherDropdowns;
    window.addWeeklyEntry = addWeeklyEntry;

    function toggleDetailField(selectElement) {
        const entry = selectElement.closest('.work-entry');
        const detailField = entry.querySelector('.detail-field');
        const val = selectElement.value;
        if (val === 'משימות אחרות' || val === 'סמינר / קורס / הכשרה') {
            detailField.style.display = 'block';
        } else { detailField.style.display = 'none'; }
    }
    window.toggleDetailField = toggleDetailField;

    function changeHours(button, change) {
        const input = button.parentElement.querySelector('.hours-input');
        const currentValue = parseFloat(input.value) || 0;
        input.value = Math.max(0, currentValue + change);
        updateTotalHours();
    }
    window.changeHours = changeHours;

    function changeDays(button, change) {
        const input = button.parentElement.querySelector('.days-input');
        const currentValue = parseFloat(input.value) || 0;
        input.value = Math.max(0, Math.min(5, currentValue + change));
        updateTotalDays();
    }
    window.changeDays = changeDays;

    function removeEntry(button) {
        button.parentElement.remove();
        updateTotalHours();
        updateTotalDays();
    }
    window.removeEntry = removeEntry;

    function updateTotalHours() {
        let total = 0;
        document.querySelectorAll('.hours-input').forEach(i => total += parseFloat(i.value) || 0);
        const el = document.getElementById('total-hours');
        if (el) el.textContent = total;
    }
    window.updateTotalHours = updateTotalHours;

    function updateTotalDays() {
        let total = 0;
        document.querySelectorAll('.days-input').forEach(i => total += parseFloat(i.value) || 0);
        const el = document.getElementById('total-days');
        if (el) el.textContent = total;
    }
    window.updateTotalDays = updateTotalDays;

    // ---------- Calendar ----------
    function renderCalendar() {
        const monthNames = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
        const title = document.getElementById('calendar-title');
        if (title) title.textContent = `${monthNames[currentMonth]} ${currentYear}`;
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const dayHeaders = ['א','ב','ג','ד','ה','ו','ש'];
        dayHeaders.forEach(day => { const div = document.createElement('div'); div.className = 'calendar-header'; div.textContent = day; grid.appendChild(div); });
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const today = new Date();
        for (let i = 0; i < firstDay; i++) { const div = document.createElement('div'); div.className = 'calendar-day'; grid.appendChild(div); }
        for (let day = 1; day <= daysInMonth; day++) {
            const div = document.createElement('div');
            div.className = 'calendar-day';
            div.textContent = day;
            const date = new Date(currentYear, currentMonth, day);
            const dateString = formatDate(date);
            if (date.toDateString() === today.toDateString()) div.classList.add('today');

            // Check if this date has a daily report OR is covered by a weekly report
            const hasDailyReport = reports.some(r => r.type === 'daily' && r.date === dateString);
            const coveredByWeeklyReport = isDateCoveredByWeeklyReport(dateString, reports);
            if (hasDailyReport || coveredByWeeklyReport) div.classList.add('has-report');

            if (date.getDay() === 5 || date.getDay() === 6) {
                div.style.background = 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)';
                div.style.color = '#9ca3af';
            }
            // --- MODIFIED ---: Updated click event listener
            div.addEventListener('click', () => {
                if (date.getDay() === 5 || date.getDay() === 6) {
                    showError('לא ניתן להוסיף דיווח לימי שישי ושבת');
                    return;
                }
                document.querySelectorAll('.calendar-day.selected').forEach(dv => dv.classList.remove('selected'));
                div.classList.add('selected');
                selectedDate = date;

                // Update action button text based on report existence
                const addBtnCalendar = document.querySelector('#calendar-screen .btn.add');
                if (addBtnCalendar) {
                    const reportExists = div.classList.contains('has-report');
                    if (reportExists) {
                        addBtnCalendar.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true" style="margin-left:6px;">edit</span>עריכת דיווח`;
                    } else {
                        addBtnCalendar.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true" style="margin-left:6px;">add_circle</span>הוספת דיווח`;
                    }
                }
            });
            grid.appendChild(div);
        }
    }
    window.previousMonth = function () { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderCalendar(); };
    window.nextMonth = function () { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderCalendar(); };

    // --- MODIFIED ---: Reworked this function to handle both "Add" and "Edit" flows
    function addCalendarReport() {
        if (!selectedDate) {
            showError('אנא בחר תאריך');
            return;
        }

        const formattedDate = formatDate(selectedDate);
        const existingReport = findReportForDate(formattedDate);

        // Reset titles and buttons to default "new report" state
        const formTitle = document.querySelector('#daily-report-screen h2');
        if (formTitle) formTitle.textContent = 'דיווח חדש';
        const submitBtn = document.querySelector('#daily-report-screen .btn[onclick="submitReport()"]');
        if (submitBtn) submitBtn.textContent = 'שמירת דיווח';

        if (existingReport) {
            // --- EDIT FLOW ---
            const editValidation = canEditExistingReport(selectedDate);
            if (!editValidation.allowed) {
                showError(editValidation.message);
                return;
            }
            showScreen('daily-report');
            populateReportForm(existingReport);
        } else {
            // --- CREATE NEW FLOW ---
            const createValidation = canCreateNewReport(selectedDate);
            if (!createValidation.allowed) {
                showError(createValidation.message);
                return;
            }
            if (createValidation.message) {
                showPopup(createValidation.message, 'info');
            }

            clearReportForm();
            setInputValue('report-date', formattedDate);

            const today = new Date();
            const weeklyToggle = document.querySelector('#report-type-toggle .toggle-option[data-type="weekly"]');
            if (weeklyToggle) {
                const isThursday = (today.getDay() === 4);
                weeklyToggle.style.opacity = isThursday ? '' : '0.5';
                weeklyToggle.setAttribute('aria-disabled', !isThursday ? 'true' : 'false');
                weeklyToggle.dataset.allowed = isThursday ? '1' : '0';
                weeklyToggle.title = isThursday ? '' : 'דיווח שבועי זמין רק בימי חמישי';
            }

            showScreen('daily-report');
            selectReportType('daily');
            selectWorkStatus('worked');
        }

        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        const dayName = dayNames[selectedDate.getDay()];
        const displayDate = `${selectedDate.getDate()}/${selectedDate.getMonth() + 1}`;
        const actionText = existingReport ? 'נפתח לעריכה' : 'נפתח דיווח';
        showPopup(`${actionText} ליום ${dayName} ${displayDate}`, 'info');
    }
    window.addCalendarReport = addCalendarReport;

    // ---------- Reports Screen ----------
    function initializeReportScreen() {
        const yearSelect = document.getElementById('report-year');
        const nowY = new Date().getFullYear();
        yearSelect.innerHTML = '';
        for (let y = nowY - 2; y <= nowY + 1; y++) { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; if (y === nowY) opt.selected = true; yearSelect.appendChild(opt); }
        document.getElementById('report-month').value = (new Date().getMonth() + 1);
    }

    function generateReport() {
        const month = parseInt(getInputValue('report-month'));
        const year = parseInt(getInputValue('report-year'));
        const resultsDiv = document.getElementById('report-results');
        // Collect reports that are relevant to the selected month/year
        const monthReports = reports.filter(r => {
            if (r.type === 'daily' && r.date) {
                const [y, m, d] = r.date.split('-').map(Number);
                const dt = new Date(y, m - 1, d);
                return dt.getMonth() + 1 === month && dt.getFullYear() === year;
            }
            if (r.type === 'weekly' && (r.weekStart || r.weekEnd || r.week)) {
                // We'll include weekly reports if any part of their week falls into the selected month
                let weekStart, weekEnd;
                if (r.weekStart && r.weekEnd) {
                    weekStart = new Date(r.weekStart);
                    weekEnd = new Date(r.weekEnd);
                } else if (r.week) {
                    const parts = r.week.split(' - ');
                    if (parts.length === 2) {
                        const [sDay, sMonth, sYear] = parts[0].split('/').map(Number);
                        const [eDay, eMonth, eYear] = parts[1].split('/').map(Number);
                        weekStart = new Date(sYear, sMonth - 1, sDay);
                        weekEnd = new Date(eYear, eMonth - 1, eDay);
                    }
                }
                if (!weekStart || !weekEnd) return false;
                // If any date in the week is in the requested month/year, include this weekly report
                const startMonth = weekStart.getMonth() + 1;
                const endMonth = weekEnd.getMonth() + 1;
                const startYear = weekStart.getFullYear();
                const endYear = weekEnd.getFullYear();
                // If the week spans months/years, check overlap
                if ((startYear === year && startMonth === month) || (endYear === year && endMonth === month)) return true;
                // Also handle weeks that start in previous month and end in next month but include the target month
                // Check if the target month-year is between start and end
                const monthStart = new Date(year, month - 1, 1);
                const monthEnd = new Date(year, month, 0);
                return weekStart <= monthEnd && weekEnd >= monthStart;
            }
            return false;
        });
        if (monthReports.length === 0) { resultsDiv.innerHTML = '<div class="notification">לא נמצאו דיווחים לחודש שנבחר</div>'; return; }

        let html = '<h3>דוח חודשי</h3>';
        let totalHours = 0;
        // totalDays should count unique calendar days in the selected month that have any report (daily or covered by weekly)
        const uniqueDays = new Set();
        const summary = {};

        monthReports.forEach(report => {
            html += `<div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">`;
            if (report.type === 'daily' && report.date) {
                // Add this calendar day to uniqueDays
                uniqueDays.add(report.date);

                const [yearStr, monthStr, dayStr] = report.date.split('-').map(Number);
                const d = new Date(yearStr, monthStr - 1, dayStr);
                html += `<h4><span class="material-symbols-outlined" style="vertical-align: middle; color:#2563eb; margin-left:6px;">calendar_today</span>${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}</h4>`;
                if (report.workStatus === 'no-work') {
                    html += '<p>לא עבד</p>';
                } else {
                    // Aggregate entries by researcher for this daily report
                    const agg = {};
                    (report.entries || []).forEach(e => {
                        const name = e.researcher || 'לא ידוע';
                        const hrs = Number(e.hours || 0) || 0;
                        if (!agg[name]) agg[name] = 0;
                        agg[name] += hrs;
                    });
                    Object.entries(agg).forEach(([name, hrs]) => {
                        html += `<p><span class="material-symbols-outlined" style="font-size:18px; vertical-align: middle; color:#059669; margin-left:6px;">schedule</span>${name}: ${hrs} שעות${''}</p>`;
                        totalHours += hrs;
                        summary[name] = summary[name] || { hours: 0, days: 0 };
                        summary[name].hours += hrs;
                        // each daily report represents one day for the researcher (counted per calendar day, not per entry)
                        summary[name].days = summary[name].days || 0; // days will be computed globally from uniqueDays
                    });
                }
            } else if (report.type === 'weekly') {
                // For weekly reports, compute the week range and list entries
                const rangeLabel = report.week || `${(report.weekStart || '').split('-').reverse().join('/')} - ${(report.weekEnd || '').split('-').reverse().join('/')}`;
                html += `<h4><span class="material-symbols-outlined" style="vertical-align: middle; color:#7c3aed; margin-left:6px;">event</span>${rangeLabel}</h4>`;

                // Determine week start/end as Date objects
                let weekStart, weekEnd;
                if (report.weekStart && report.weekEnd) {
                    weekStart = new Date(report.weekStart);
                    weekEnd = new Date(report.weekEnd);
                } else if (report.week) {
                    const weekParts = report.week.split(' - ');
                    if (weekParts.length === 2) {
                        const [startPart, endPart] = weekParts;
                        const [startDay, startMonth, startYear] = startPart.split('/').map(Number);
                        const [endDay, endMonth, endYear] = endPart.split('/').map(Number);
                        weekStart = new Date(startYear, startMonth - 1, startDay);
                        weekEnd = new Date(endYear, endMonth - 1, endDay);
                    }
                }

                // Add each date in the weekly range that falls into the selected month to uniqueDays
                if (weekStart && weekEnd) {
                    const iter = new Date(weekStart);
                    while (iter <= weekEnd) {
                        const ds = formatDate(iter);
                        const y = iter.getFullYear();
                        const m = iter.getMonth() + 1;
                        if (y === year && m === month) uniqueDays.add(ds);
                        iter.setDate(iter.getDate() + 1);
                    }
                }

                (report.entries || []).forEach(e => {
                    const days = Number(e.days || 0) || 0;
                    const hours = days * (window.APP_CONFIG?.hoursPerDay || 8);
                    html += `<p><span class="material-symbols-outlined" style="font-size:18px; vertical-align: middle; color:#059669; margin-left:6px;">schedule</span>${e.researcher}: ${e.days} ימים (${hours} שעות)${e.detail ? ' - ' + e.detail : ''}</p>`;
                    totalHours += hours;
                    summary[e.researcher] = summary[e.researcher] || { hours: 0, days: 0 };
                    summary[e.researcher].days += days;
                    summary[e.researcher].hours += hours;
                });
            }
            html += '</div>';
        });

        // totalDays is number of unique calendar days in the selected month that had any report
        const totalDays = uniqueDays.size;

        html += '<div style="margin-top: 30px; padding: 20px; background-color: #f9fafb; border-radius: 8px; border:1px dashed #e5e7eb;">';
        html += `<h3><span class="material-symbols-outlined" style="vertical-align: middle; color:#2563eb; margin-left:6px;">insights</span>סיכום חודשי</h3><p><strong>סה"כ שעות: ${totalHours}</strong></p><p><strong>סה"כ ימים: ${totalDays}</strong></p><h4 style="margin-top:12px;">פילוח לפי חוקר/פרויקט:</h4>`;

        // For the per-researcher summary, ensure hours already reflect aggregation; days in this summary may remain as previously computed (for weekly entries we used reported days)
        Object.entries(summary).forEach(([name, s]) => {
            const hoursText = s.hours > 0 ? s.hours + ' שעות ' : '';
            const daysText = s.days > 0 ? s.days + ' ימים' : '';
            html += `<p><span class="material-symbols-outlined" style="font-size:18px; vertical-align: middle; color:#6b7280; margin-left:6px;">person</span>${name}: ${hoursText}${daysText}</p>`;
        });
        html += '</div>';
        resultsDiv.innerHTML = html;
    }
    window.generateReport = generateReport;

    // ---------- Notifications ----------
    function updateNotifications() {
        const missingDiv = document.getElementById('missing-reports');
        const notificationsDiv = document.getElementById('notifications');
        if (!missingDiv || !notificationsDiv) return;
        missingDiv.innerHTML = ''; notificationsDiv.innerHTML = '';
        const today = new Date();
        const weekStart = getSundayOfWeek(today);
        const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

        // If there is a weekly report for this week, do not show missing
        const weeklyCovered = reports.some(r => r.type === 'weekly' && (r.week === getCurrentWeek() || (r.weekStart && r.weekEnd && `${r.weekStart.split('-').reverse().join('/') } - ${r.weekEnd.split('-').reverse().join('/')}` === getCurrentWeek())));
        const missing = [];

        for (let i = 0; i < 5; i++) { // Sun-Thu
            const checkDate = new Date(weekStart);
            checkDate.setDate(weekStart.getDate() + i);
            if (checkDate <= today) {
                const dateString = formatDate(checkDate);
                const hasDaily = reports.some(r => r.type === 'daily' && r.date === dateString);
                if (!hasDaily && !weeklyCovered) missing.push(checkDate);
            }
        }

        // Cap to 4 messages, reset each Sunday implicitly as we compute per current week
        const limited = missing.slice(0, 4);
        if (limited.length > 0) {
            let html = '<div class="missing-reports-container">';
            html += '<h4 style="color: #dc2626; margin-bottom: 10px;">הודעות - דיווחים חסרים השבוע</h4>';
            limited.forEach(d => {
                const dayName = dayNames[d.getDay()];
                const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
                const formattedDate = formatDate(d);
                html += `<div class="missing-report-item">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="missing-day">${dayName}</span>
                        <span class="missing-date">${dateStr}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="missing-status">חסר דיווח</span>
                        <button class="add-missing-report-btn" onclick="addReportForDate('${formattedDate}')" title="הוספת דיווח ל${dayName} ${dateStr}">
                            <span class="material-symbols-outlined">add_circle</span>
                        </button>
                    </div>
                </div>`;
            });
            html += '</div>';
            missingDiv.innerHTML = html;
        }
    }

    /**
     * פונקציה להוספת דיווח לתאריך ספציפי מההודעות
     * דרישה: כפתור הוסף דיווח בהודעות הדיווחים החסרים
     * @param {string} dateString תאריך בפורמט YYYY-MM-DD
     */
    function addReportForDate(dateString) {
        const [year, month, day] = dateString.split('-').map(Number);
        const targetDate = new Date(year, month - 1, day);
        const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

        // בדיקה אם התאריך חוקי לדיווח
        const existingReport = reports.find(r => r.date === dateString);

        if (existingReport) {
            // יש דיווח קיים - בודק אם ניתן לערוך
            const editValidation = canEditExistingReport(targetDate);
            if (!editValidation.allowed) {
                showError(editValidation.message);
                return;
            }
        } else {
            // אין דיווח - בודק אם ניתן ליצור חדש
            const createValidation = canCreateNewReport(targetDate);
            if (!createValidation.allowed) {
                showError(createValidation.message);
                return;
            }
        }

        // Set the target date in the form
        setInputValue('report-date', dateString);

        // דרישה: כפתור הוסף דיווח - בין הימים א'-ד' מסך דיווח חדש יומי, ביום ה' יומי/שבועי
        const today = new Date();
        const weeklyToggle = document.querySelector('#report-type-toggle .toggle-option[data-type="weekly"]');
        if (weeklyToggle) {
            const isThursday = (today.getDay() === 4);
            const allowed = isThursday;
            weeklyToggle.style.opacity = allowed ? '' : '0.5';
            weeklyToggle.setAttribute('aria-disabled', allowed ? 'false' : 'true');
            weeklyToggle.dataset.allowed = allowed ? '1' : '0';
            weeklyToggle.title = allowed ? '' : 'דיווח שבועי זמין רק בימי חמישי';
        }

        showScreen('daily-report');
        selectReportType('daily'); // Always start with daily
        selectWorkStatus('worked'); // Default to worked

        // הודעת אישור על התאריך שנבחר
        const dayName = dayNames[targetDate.getDay()];
        const displayDate = `${targetDate.getDate()}/${targetDate.getMonth() + 1}`;
        showPopup(`נפתח דיווח ליום ${dayName} ${displayDate}`, 'info');
    }
    window.addReportForDate = addReportForDate;

    // ---------- Researchers UI ----------
    function renderResearchers() {
        const container = document.getElementById('researchers-list');
        if (!container) return;
        container.innerHTML = '';
        const list = Array.isArray(allResearchers) ? allResearchers : [];
        list.forEach(name => {
            const div = document.createElement('div');
            div.className = 'researcher-item';
            const id = `researcher-${name}`;
            const checked = activeResearchers.includes(name) ? 'checked' : '';
            div.innerHTML = `<input type="checkbox" id="${id}" ${checked}><label for="${id}">${name}</label>`;
            container.appendChild(div);
        });
        // Add fixed, non-editable items at the end per spec
        ['משימות אחרות', 'סמינר / קורס / הכשרה'].forEach(item => {
            const div = document.createElement('div');
            div.className = 'researcher-item';
            div.innerHTML = `<input type="checkbox" checked disabled><label>${item}</label>`;
            container.appendChild(div);
        });
    }
    window.renderResearchers = renderResearchers;

    function saveResearchers() {
        // Update local state immediately from checkboxes
        activeResearchers = [];
        document.querySelectorAll('#researchers-list input[type="checkbox"]:checked:not([disabled])').forEach(cb => {
            const name = cb.id.replace('researcher-', '');
            activeResearchers.push(name);
        });

        // Immediately refresh dropdowns in open report forms (so removals reflect instantly)
        refreshResearcherDropdowns();

        // Persist to database; server listener will also update state
        if (currentUser) {
            database.ref('users/' + currentUser.uid + '/activeResearchers')
                .set(activeResearchers)
                .then(() => {
                    showPopup('החוקרים הפעילים נשמרו בהצלחה');
                    // Extra safety: refresh again after confirmation
                    refreshResearcherDropdowns();
                })
                .catch(() => {});
        }
    }
    window.saveResearchers = saveResearchers;

    // ---------- Profile UI ----------
    function editProfile() {
        // Handle both input and select elements (profile-position is now a <select>)
        const fields = document.querySelectorAll('#user-profile-screen input, #user-profile-screen select');
        if (!fields || fields.length === 0) return;

        // Determine current state: check first field's readonly/disabled
        const first = fields[0];
        let isReadonly = false;
        if (first.tagName.toLowerCase() === 'input') isReadonly = first.hasAttribute('readonly');
        else if (first.tagName.toLowerCase() === 'select') isReadonly = first.hasAttribute('disabled');

        fields.forEach(el => {
            if (el.tagName.toLowerCase() === 'input') {
                if (isReadonly) el.removeAttribute('readonly'); else el.setAttribute('readonly', 'readonly');
            } else if (el.tagName.toLowerCase() === 'select') {
                if (isReadonly) el.removeAttribute('disabled'); else el.setAttribute('disabled', 'disabled');
            }
        });

        const btn = document.querySelector('#user-profile-screen .btn');
        if (btn) btn.textContent = isReadonly ? 'שמירה' : 'עריכה';

        // When toggling from editable back to readonly, save the values
        if (!isReadonly) {

            const data = {
                firstName: getInputValue('profile-first-name'),
                lastName: getInputValue('profile-last-name'),
                position: getInputValue('profile-position'),
                email: getInputValue('profile-email')
            };
            if ((data.position || '') === 'מהנדס מחקר') {
                const selVal = getInputValue('profile-my-manager') || '';
                data.my_manager = selVal;
                if (selVal.includes('|')) {
                    const [fullName, email] = selVal.split('|');
                    data.my_manager_fullName = fullName.trim();
                    data.my_manager_email = email.trim();
                } else {
                    data.my_manager_fullName = '';
                    data.my_manager_email = '';
                }
            } else {
                data.my_manager = '';
                data.my_manager_fullName = '';
                data.my_manager_email = '';
            }
            if (currentUser) updateUserProfile(currentUser.uid, data).then(() => showPopup('הפרטים נשמרו'));
        }
    }
    window.editProfile = editProfile;

    function updateActiveSelectionFromUI() {
        const container = document.getElementById('researchers-list');
        if (!container) return;
        const selected = [];
        container.querySelectorAll('input[type="checkbox"]:checked:not([disabled])').forEach(cb => {
            const name = cb.id.replace('researcher-', '');
            selected.push(name);
        });
        activeResearchers = selected;
        refreshResearcherDropdowns();
    }

    // ---------- Auth UI ----------
    function switchAuthTab(tab) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.querySelector(`#${tab}-form`).classList.add('active');
        document.querySelector(`.auth-tab[onclick="switchAuthTab('${tab}')"]`).classList.add('active');
    }
    window.switchAuthTab = switchAuthTab;

    function showForgotPassword() { document.getElementById('forgot-password-form').classList.add('active'); document.getElementById('login-form').classList.remove('active'); }
    window.showForgotPassword = showForgotPassword;
    function backToLogin() { document.getElementById('forgot-password-form').classList.remove('active'); document.getElementById('login-form').classList.add('active'); }
    window.backToLogin = backToLogin;

    // Process email action links (verifyEmail) when opened via handleCodeInApp
    async function processEmailActionLink() {
        try {
            const params = new URLSearchParams(window.location.search);
            const mode = params.get('mode');
            const oobCode = params.get('oobCode');
            if (mode === 'verifyEmail' && oobCode) {
                // Show login screen message placeholder
                showScreen('login');
                setHTML('login-messages', '<div class="success-message">מאמת את כתובת האימייל שלך...</div>');
                try {
                    await auth.applyActionCode(oobCode);
                    setHTML('login-messages', '<div class="success-message">האימייל אומת בהצלחה. ניתן להתחבר עכשיו.</div>');
                } catch (e) {
                    setHTML('login-messages', `<div class="error-message">${translateErrorMessage({ code: 'auth/invalid-action-code', message: e && e.message || 'קישור אימות לא תקין' })}</div>`);
                } finally {
                    // Clean URL
                    const url = new URL(window.location.href);
                    url.searchParams.delete('mode');
                    url.searchParams.delete('oobCode');
                    url.searchParams.delete('apiKey');
                    url.searchParams.delete('lang');
                    window.history.replaceState({}, document.title, url.toString());
                }
            }
        } catch (_) {}
    }

    function isAllowedDomain(email) {
        const pattern = /^[^@\s]+@volcani\.agri\.gov\.il$/i;
        return pattern.test(String(email || ''));
    }

    function signInUser(email, password) {
        if (!isAllowedDomain(email)) {
            const err = { code: 'auth/email-domain-not-allowed', message: 'כתובת האימייל חייבת להיות בדומיין של המכון' };
            return Promise.reject(err);
        }
        return auth.signInWithEmailAndPassword(email, password);
    }

    function createUser(data) {
        if (!isAllowedDomain(data.email)) {
            const err = { code: 'auth/email-domain-not-allowed', message: 'כתובת האימייל חייבת להיות בדומיין של המכון' };
            return Promise.reject(err);
        }
        return auth.createUserWithEmailAndPassword(data.email, data.password).then(async (cred) => {
            const uid = cred.user.uid;
            const payload = { firstName: data.firstName, lastName: data.lastName, position: data.position, email: data.email, createdAt: new Date().toISOString() };
            if ((data.position || '') === 'מהנדס מחקר') {
                payload.my_manager = data.my_manager || '';
            }
            await database.ref('users/' + uid).set(payload).catch(() => {});

            // אם המשתמש הוא מנהל, הוסף אותו לרשימת המנהלים הגלובלית (לבחירה בלבד)
            // הרשאות אמיתיות ניתנות רק דרך הכללים ב-firebase-rules.json
            if (data.position === 'מנהל') {
                const managerData = {
                    firstName: data.firstName,
                    lastName: data.lastName,
                    fullName: `${data.firstName} ${data.lastName}`,
                    email: data.email,
                    uid: uid,
                    createdAt: new Date().toISOString(),
                    isApproved: false // לא מאושר כמנהל אמיתי עד שלא יוסיף למיילים ב-rules
                };
                await database.ref('managers/' + uid).set(managerData).catch((error) => {
                    console.error('Error adding manager to global list:', error);
                });
            }

            return cred;
        });
    }

    // Allow resending verification from login screen
    window.resendVerificationFromLogin = async function () {
        const email = getInputValue('login-email');
        const password = getInputValue('login-password');
        if (!email || !password) { setHTML('login-messages', '<div class="error-message">הזן אימייל וסיסמה כדי לשלוח אימות מחדש</div>'); return; }
        if (!isAllowedDomain(email)) { setHTML('login-messages', '<div class="error-message">כתובת האימייל חייבת להיות בדומיין של המכון</div>'); return; }
        try {
            const cred = await auth.signInWithEmailAndPassword(email, password);
            setHTML('login-messages', '<div class="success-message">התחברת בהצלחה</div>');
        } catch (err) {
            setHTML('login-messages', `<div class=\"error-message\">${translateErrorMessage(err)}</div>`);
        }
    };

    function translateErrorMessage(error) {
        // Normalize possible error representations (Error object, plain object, or string)
        if (!error) return 'שגיאה בלתי צפויה';
        if (typeof error === 'string') {
            // If Firebase sometimes returns the raw message containing the code, try to extract it
            const codeMatch = error.match(/auth\/[a-z-]+/i);
            if (codeMatch) {
                error = { code: codeMatch[0], message: error };
            } else {
                return error;
            }
        }

        // If no code property, try to extract from message
        if (!error.code && error.message) {
            const codeMatch = error.message.match(/auth\/[a-z-]+/i);
            if (codeMatch) error.code = codeMatch[0];
        }

        const errorMessages = {
            'auth/invalid-email': 'כתובת האימייל אינה חוקית',
            'auth/user-disabled': 'המשתמש הושבת',
            'auth/user-not-found': 'משתמש לא נמצא',
            'auth/wrong-password': 'סיסמה שגויה',
            'auth/weak-password': 'סיסמה חלשה מדי',
            'auth/email-already-in-use': 'האימייל כבר רשום במערכת',
            'auth/email-domain-not-allowed': 'רק מייל בדומיין של המכון מורשה',
            'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שוב מאוחר יותר',
            // Friendly message for invalid login credentials (Firebase may surface this code or only include it in the message)
            'auth/invalid-login-credentials': 'אימייל/סיסמא אינם תקינים'
        };
        return (error.code && errorMessages[error.code]) ? errorMessages[error.code] : (error.message || 'שגיאה בלתי צפויה');
    }

    // ---------- Helpers ----------
    function setInputValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
    function getInputValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }
    function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
    function toggleHidden(id, isHidden) { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', isHidden); }
    function showPopup(message, type = 'success') {
        const popup = document.createElement('div');
        popup.className = 'popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-live', 'assertive');
        popup.setAttribute('aria-modal', 'true');

        let innerClass;
        switch(type) {
            case 'error':
                innerClass = 'error-message';
                break;
            case 'info':
                innerClass = 'info-message';
                break;
            default:
                innerClass = 'success-message';
                break;
        }

        popup.innerHTML = `<div class="popup-content"><div class="${innerClass}">${message}</div></div>`;
        document.body.appendChild(popup);
        setTimeout(() => {
            if (popup.parentNode) document.body.removeChild(popup);
        }, 3000);
    }
    function showError(message) { showPopup(message, 'error'); }
    function formatDate(date) {
        // Fix timezone issue by creating date in local timezone
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    function getCurrentWeek() { 
        const now = new Date(); 
        const sunday = getSundayOfWeek(now);
        const thursday = new Date(sunday);
        thursday.setDate(sunday.getDate() + 4);
        const startDate = `${String(sunday.getDate()).padStart(2,'0')}/${String(sunday.getMonth()+1).padStart(2,'0')}/${sunday.getFullYear()}`;
        const endDate = `${String(thursday.getDate()).padStart(2,'0')}/${String(thursday.getMonth()+1).padStart(2,'0')}/${thursday.getFullYear()}`;
        return `${startDate} - ${endDate}`;
    }
    
    function getCurrentWeekForStorage() { 
        const now = new Date(); 
        const sunday = getSundayOfWeek(now);
        const thursday = new Date(sunday);
        thursday.setDate(sunday.getDate() + 4);
        return `${formatDate(sunday)}_${formatDate(thursday)}`;
    }
    /**
     * מחזיר את טווח השבוע לתאריך נתון
     * @param {Date} date התאריך לבדיקה
     * @returns {string} טווח השבוע בפורמט DD/MM/YYYY - DD/MM/YYYY
     */
    function getWeekForDate(date) {
        const sunday = getSundayOfWeek(date);
        const thursday = new Date(sunday);
        thursday.setDate(sunday.getDate() + 4);
        const startDate = `${String(sunday.getDate()).padStart(2,'0')}/${String(sunday.getMonth()+1).padStart(2,'0')}/${sunday.getFullYear()}`;
        const endDate = `${String(thursday.getDate()).padStart(2,'0')}/${String(thursday.getMonth()+1).padStart(2,'0')}/${thursday.getFullYear()}`;
        return `${startDate} - ${endDate}`;
    }

    // Manager UI visibility helper (registration + profile)
    function updateManagerUIVisibility(positionVal) {
        // Registration screen
        const regGroup = document.getElementById('register-my-manager-group');
        const regWarn = document.getElementById('register-manager-warning');
        if (regGroup) regGroup.style.display = (positionVal === 'מהנדס מחקר') ? '' : 'none';
        if (regWarn) regWarn.style.display = (positionVal === 'מנהל') ? '' : 'none';

        // Profile screen
        const profGroup = document.getElementById('profile-my-manager-group');
        const profWarn = document.getElementById('profile-manager-warning');
        const effectivePos = positionVal || (document.getElementById('profile-position')?.value || '');
        if (profGroup) profGroup.style.display = (effectivePos === 'מהנדס מחקר') ? '' : 'none';
        if (profWarn) profWarn.style.display = (effectivePos === 'מנהל') ? '' : 'none';
    }
    /**
     * מחזיר את מפתח האחסון לשבוע של תאריך נתון
     * @param {Date} date התאריך לבדיקה
     * @returns {string} מפתח האחסון בפורמט YYYY-MM-DD_YYYY-MM-DD
     */
    function getWeekForStorageByDate(date) {
        const sunday = getSundayOfWeek(date);
        const thursday = new Date(sunday);
        thursday.setDate(sunday.getDate() + 4);
        return `${formatDate(sunday)}_${formatDate(thursday)}`;
    }

    // Expose for admin.js
    window.updateAdminUI = function () {
        const adminNavBtn = document.getElementById('admin-nav-btn');
        if (adminNavBtn) adminNavBtn.style.display = isAdmin ? '' : 'none';
    };
    window.initializeAdminScreen = function () { if (!isAdmin) return; const yearSelect = document.getElementById('admin-year'); const nowY = new Date().getFullYear(); yearSelect.innerHTML = ''; for (let y = nowY - 2; y <= nowY + 1; y++) { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; if (y === nowY) opt.selected = true; yearSelect.appendChild(opt); } document.getElementById('admin-month').value = new Date().getMonth() + 1; };

    // ---------- Event listeners ----------
    document.addEventListener('DOMContentLoaded', function () {
        // toggles
        document.querySelectorAll('#report-type-toggle .toggle-option').forEach(option => option.addEventListener('click', function () {
            const allowed = this.dataset.allowed !== '0' && this.getAttribute('aria-disabled') !== 'true';
            if (!allowed && this.dataset.type === 'weekly') { showError('לא ניתן למלא דיווח שבועי כעת'); return; }
            selectReportType(this.dataset.type);
        }));
        document.querySelectorAll('#work-status-toggle .toggle-option').forEach(option => option.addEventListener('click', function () { selectWorkStatus(this.dataset.status); }));
        // auth forms
        const signin = document.getElementById('signin-form');
        if (signin) signin.addEventListener('submit', function (e) {
            e.preventDefault(); const email = getInputValue('login-email'); const pwd = getInputValue('login-password');
            signInUser(email, pwd).catch(err => setHTML('login-messages', `<div class="error-message">${translateErrorMessage(err)}</div>`));
        });
        const resendBtn = document.getElementById('resend-verification-btn');
        if (resendBtn) resendBtn.addEventListener('click', function () {
            if (this.dataset.loading === '1') return; this.dataset.loading = '1';
            this.disabled = true;
            window.resendVerificationFromLogin().finally(() => { this.disabled = false; this.dataset.loading = '0'; });
        });
        const signup = document.getElementById('signup-form');
        if (signup) signup.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (this.dataset.loading === '1') return;
            this.dataset.loading = '1';
            const submitBtn = this.querySelector('button[type="submit"]');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'נרשם...'; }
            setHTML('register-messages', '');

            const data = { firstName: getInputValue('register-first-name'), lastName: getInputValue('register-last-name'), position: getInputValue('register-position'), email: getInputValue('register-email'), password: getInputValue('register-password') };
            if (data.position === 'מהנדס מחקר') {
                data.my_manager = getInputValue('register-my-manager') || '';
            }
            const confirm = getInputValue('register-confirm-password');
            if (data.password !== confirm) { setHTML('register-messages', '<div class="error-message">סיסמאות אינן תואמות</div>'); if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'הרשמה'; } this.dataset.loading = '0'; return; }

            try {
                const res = await createUser(data);
                if (res && res.sentVerification) {
                    setHTML('register-messages', '<div class="success-message">נשלח אליך מייל אימות. יש לאמת את הכתובת לפני התחברות. בדוק את תיבת הדואר והספאם.</div>');
                    // optionally switch to login tab
                    switchAuthTab('login');
                } else {
                    setHTML('register-messages', '<div class="success-message">ההרשמה הושלמה. אנא אמת את כתובת האימייל שנשלחה אליך.</div>');
                    switchAuthTab('login');
                }
            } catch (err) {
                setHTML('register-messages', `<div class="error-message">${translateErrorMessage(err)}</div>`);
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'הרשמה'; }
                this.dataset.loading = '0';
            }
        });
        // Role-based manager UI
        const regPos = document.getElementById('register-position');
        if (regPos) {
            regPos.addEventListener('change', function(){ updateManagerUIVisibility(this.value); });
            updateManagerUIVisibility(regPos.value);
        }
        const resetForm = document.getElementById('reset-password-form');
        if (resetForm) resetForm.addEventListener('submit', function (e) {
            e.preventDefault(); const email = getInputValue('reset-email'); auth.sendPasswordResetEmail(email).then(() => setHTML('forgot-password-messages', '<div class="success-message">קישור לשחזור סיסמה נשלח למייל שלך - (עשוי לקחת מספר דקות)</div>')).catch(err => setHTML('forgot-password-messages', `<div class="error-message">${translateErrorMessage(err)}</div>`));
        });

        // live update dropdowns on checkbox toggle in active researchers screen
        const researchersList = document.getElementById('researchers-list');
        if (researchersList) researchersList.addEventListener('change', function (e) {
            if (e.target && e.target.matches('input[type="checkbox"]')) {
                updateActiveSelectionFromUI();
            }
        });

        // initial
        init();
        processEmailActionLink();

        // Update weekly date range when report date changes
        const reportDateInput = document.getElementById('report-date');
        if (reportDateInput) {
            reportDateInput.addEventListener('change', function() {
                // Check if weekly report is currently selected
                const weeklyToggle = document.querySelector('#report-type-toggle .toggle-option[data-type="weekly"]');
                if (weeklyToggle && weeklyToggle.classList.contains('active')) {
                    // Update the week range and hint when date changes
                    const reportDate = this.value;
                    if (reportDate) {
                        const [year, month, day] = reportDate.split('-').map(Number);
                        const selectedDate = new Date(year, month - 1, day);
                        const weekRange = getWeekForDate(selectedDate);
                        setInputValue('report-week', weekRange);
                        renderWeeklyDatesHint();
                    }
                }
            });
        }

        // Do not auto-add entries here; entries are created when opening the report screen
        // setTimeout(() => { addWorkEntry(); }, 100);

        // Accessibility/init for Add Researcher toggle
        try {
            const addBtn = document.getElementById('add-new-btn');
            const form = document.getElementById('add-researcher-form');
            if (addBtn && form) {
                addBtn.setAttribute('aria-controls', 'add-researcher-form');
                addBtn.setAttribute('aria-expanded', 'false');
                form.setAttribute('aria-hidden', 'true');
                form.setAttribute('role', 'form');
            }
        } catch (e) { /* ignore */ }
    });

    function getSundayOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        return new Date(d.setDate(diff));
    }

    // ---------- Date Initialization ----------
    function initializeDates() {
        // Initialize current month and year for calendar
        const now = new Date();
        currentMonth = now.getMonth();
        currentYear = now.getFullYear();

        // Initialize current week
        currentWeek = getCurrentWeek();
    }

    // ---------- Add New Researcher Functions ----------
    function addNewResearcher() {
        const input = document.getElementById('new-researcher-name');
        if (!input) return;

        const newName = input.value.trim();
        if (!newName) {
            showError('אנא הזן שם החוקר');
            return;
        }

        // בדוק אם החוקר כבר קיים ברשימה הגלובלית
        if (allResearchers.includes(newName)) {
            showError('החוקר כבר קיים ברשימה');
            return;
        }

        // בדוק אם החוקר כבר קיים ברשימה הפעילה
        if (activeResearchers.includes(newName)) {
            showError('החוקר כבר קיים ברשימת החוקרים הפעילים');
            return;
        }

        // הוסף את החוקר לרשימה הגלובלית מקומית
        allResearchers.push(newName);

        // הוסף את החוקר לרשימת החוקרים הפעילים מקומית
        activeResearchers.push(newName);

        // רענן את התצוגה מיד
        renderResearchers();
        refreshResearcherDropdowns();

        showPopup(`החוקר "${newName}" נוסף בהצלחה לרשימת החוקרים הפעילים`);

        // נקה את השדה
        input.value = '';

        // נסה לעדכן את Firebase אבל אל תיכשל אם אין הרשאות
        // זה יקרה רק אם המשתמש הוא מנהל
        if (currentUser && isAdmin) {
            database.ref('global/researchers').set(allResearchers).catch(() => {
                // שקט - לא נציג שגיאה כי המשתמש רגיל לא צריך הרשאות לעדכן את הרשימה הגלובלית
            });
        }

        // עדכן את Firebase עם הרשימה הפעילה המעודכנת
        if (currentUser) {
            database.ref('users/' + currentUser.uid + '/activeResearchers').set(activeResearchers).catch(() => {
                showError('שגיאה בשמירת החוקר ברשימה הפעילה');
            });
        }
    }
    window.addNewResearcher = addNewResearcher;

    // ---------- Manager Management Functions ----------

    /**
     * טוען רשימת מנהלים מ-Firebase
     * @returns {Promise<Array>} רשימת מנהלים
     */
    async function loadManagersList() {
        try {
            const snapshot = await database.ref('managers').once('value');
            const managers = snapshot.val() || {};

            // המר את אובייקט המנהלים למערך
            const managersList = Object.entries(managers).map(([id, manager]) => ({
                id,
                fullName: manager.fullName || `${manager.firstName} ${manager.lastName}`,
                email: manager.email,
                firstName: manager.firstName,
                lastName: manager.lastName
            }));

            return managersList;
        } catch (error) {
            console.error('Error loading managers list:', error);
            return [];
        }
    }

    /**
     * מעדכן את רשימת המנהלים ב-dropdown של הפרופיל
     */
    async function updateManagersDropdown() {
        const managerSelect = document.getElementById('profile-my-manager');
        const loadingElement = document.getElementById('manager-loading');

        if (!managerSelect) return;

        try {
            if (loadingElement) loadingElement.style.display = 'block';

            const managers = await loadManagersList();

            // שמור את הבחירה הנוכחית
            const currentValue = managerSelect.value;

            // נקה את הרשימה הקיימת
            managerSelect.innerHTML = '';

            // הוסף אפשרות ברירת מחדל
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'בחר/י מנהל';
            managerSelect.appendChild(defaultOption);

            // הוסף מנהלים לרשימה
            managers.forEach(manager => {
                const option = document.createElement('option');
                option.value = `${manager.fullName}|${manager.email}`;
                option.textContent = `${manager.fullName} (${manager.email})`;
                managerSelect.appendChild(option);
            });

            // החזר את הבחירה הקיימת אם קיימת
            if (currentValue) {
                managerSelect.value = currentValue;
            }

            if (loadingElement) loadingElement.style.display = 'none';

        } catch (error) {
            console.error('Error updating managers dropdown:', error);
            if (loadingElement) {
                loadingElement.textContent = 'שגיאה בטעינת רשימת מנהלים';
                loadingElement.style.color = '#dc2626';
            }
        }
    }

    /**
     * מעדכן את הנראות של שדה המנהל לפי התפקיד
     * @param {string} position התפקיד
     */
    function updateManagerUIVisibility(position) {
        const managerGroup = document.getElementById('profile-my-manager-group');
        const managerWarning = document.getElementById('profile-manager-warning');
        const registerManagerNote = document.getElementById('register-manager-selection-note');
        const registerManagerWarning = document.getElementById('register-manager-warning');

        if (position === 'מהנדס מחקר') {
            if (managerGroup) {
                managerGroup.style.display = 'block';
                updateManagersDropdown(); // טען רשימת מנהלים
            }
            if (managerWarning) managerWarning.style.display = 'none';
            if (registerManagerNote) registerManagerNote.style.display = 'block';
            if (registerManagerWarning) registerManagerWarning.style.display = 'none';
        } else if (position === 'מנהל') {
            if (managerGroup) managerGroup.style.display = 'none';
            if (managerWarning) managerWarning.style.display = 'block';
            if (registerManagerNote) registerManagerNote.style.display = 'none';
            if (registerManagerWarning) registerManagerWarning.style.display = 'block';
        } else {
            if (managerGroup) managerGroup.style.display = 'none';
            if (managerWarning) managerWarning.style.display = 'none';
            if (registerManagerNote) registerManagerNote.style.display = 'none';
            if (registerManagerWarning) registerManagerWarning.style.display = 'none';
        }
    }

    // חשוף את הפונקציה לשימוש גלובלי
    window.updateManagerUIVisibility = updateManagerUIVisibility;
})();
