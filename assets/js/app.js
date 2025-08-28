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
                        window.location.href = '/admin-dashboard/index.html';
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
                        window.location.href = '/admin-dashboard/index.html';
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
        if (screenName === 'reports') initializeReportScreen();
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

    function loadUserProfile(uid) {
        return database.ref('users/' + uid).once('value').then((snapshot) => {
            const userData = snapshot.val() || {};
            setInputValue('profile-first-name', userData.firstName || '');
            setInputValue('profile-last-name', userData.lastName || '');
            setInputValue('profile-position', userData.position || '');
            setInputValue('profile-email', userData.email || (currentUser ? currentUser.email : ''));
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
            activeResearchersRef.on('value', snap => {
                const data = snap.val();
                if (Array.isArray(data) && data.length > 0) {
                    activeResearchers = data;
                } else {
                    // default: first 5 from global list
                    activeResearchers = (allResearchers || []).slice(0, 5);
                }
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

    function submitReport() {
        const reportDate = getInputValue('report-date');
        if (!reportDate) { showError('אנא הזן תאריך'); return; }
        // Create date in local timezone to avoid timezone issues
        const [year, month, day] = reportDate.split('-').map(Number);
        const d = new Date(year, month - 1, day);
        if (d.getDay() === 5 || d.getDay() === 6) { showError('לא ניתן לדווח עבודה בימי שישי ושבת'); return; }

        const isWeekly = document.getElementById('daily-form').classList.contains('hidden');
        const reportData = { date: reportDate, type: isWeekly ? 'weekly' : 'daily', timestamp: firebase.database.ServerValue.TIMESTAMP, entries: [] };

        if (!isWeekly) {
            const workStatus = document.querySelector('#work-status-toggle .toggle-option.active')?.dataset.status || 'worked';
            reportData.workStatus = workStatus;
            if (workStatus === 'worked') {
                document.querySelectorAll('#work-entries .work-entry').forEach(entry => {
                    const researcher = entry.querySelector('.researcher-select')?.value || '';
                    const hours = parseFloat(entry.querySelector('.hours-input')?.value || '0') || 0;
                    const detail = (entry.querySelector('textarea')?.value) || '';
                    if (researcher && hours > 0) reportData.entries.push({ researcher, hours, detail });
                });
            }
        } else {
            const today = new Date();
            if (today.getDay() !== 4) { showError('דיווח שבועי זמין רק בימי חמישי'); return; }
            const week = getInputValue('report-week');
            reportData.week = week;
            const weeklyEntries = [];
            document.querySelectorAll('#weekly-entries .work-entry').forEach(entry => {
                const researcher = entry.querySelector('.researcher-select')?.value || '';
                const days = parseFloat(entry.querySelector('.days-input')?.value || '0') || 0;
                const detail = (entry.querySelector('textarea')?.value) || '';
                if (researcher && days > 0) weeklyEntries.push({ researcher, days, detail });
            });
            if (weeklyEntries.length === 0) { showError('אנא הזן לפחות שורה אחת לדיווח שבועי'); return; }
            // Compute range for storage and filtering
            const sunday = getSundayOfWeek(today);
            const thursday = new Date(sunday); thursday.setDate(sunday.getDate() + 4);
            reportData.weekStart = formatDate(sunday);
            reportData.weekEnd = formatDate(thursday);
            if (!currentUser) return;
            const weeklyKey = `weekly_${getCurrentWeekForStorage()}`;
            // Build daily fan-out distributed evenly across Sun–Thu
            const dates = [];
            for (let i = 0; i < 5; i++) { const d2 = new Date(sunday); d2.setDate(sunday.getDate() + i); dates.push(formatDate(d2)); }
            const perDayEntries = dates.map(() => []);
            weeklyEntries.forEach(({ researcher, days, detail }) => {
                const hoursPerDayBase = (Number(days) || 0) * (window.APP_CONFIG?.hoursPerDay || 8) / 5;
                let accumulated = 0;
                for (let i = 0; i < 5; i++) {
                    let hours;
                    if (i < 4) {
                        hours = roundToHalf(hoursPerDayBase);
                        accumulated += hours;
                    } else {
                        // Last day absorbs the remainder to ensure exact total
                        const totalHours = (Number(days) || 0) * (window.APP_CONFIG?.hoursPerDay || 8);
                        hours = Math.max(0, totalHours - accumulated);
                        // Round last day to 0.5 to match UI granularity while preserving total as close as possible
                        hours = Math.round(hours * 2) / 2;
                        // Adjust tiny rounding drift
                        const drift = (accumulated + hours) - totalHours;
                        if (Math.abs(drift) >= 0.5) {
                            hours -= Math.sign(drift) * 0.5;
                        }
                    }
                    if (hours > 0) perDayEntries[i].push({ researcher, hours, detail });
                }
            });
            // Prepare updates: overwrite this week's daily_* docs only (no weekly doc stored)
            const updates = {};
            for (let i = 0; i < 5; i++) {
                const dateStr = dates[i];
                const dailyKey = `daily_${dateStr}`;
                updates[`reports/${currentUser.uid}/${dailyKey}`] = { date: dateStr, type: 'daily', timestamp: firebase.database.ServerValue.TIMESTAMP, entries: perDayEntries[i] };
            }
            database.ref().update(updates).then(() => {
                showPopup('הדיווח השבועי הומר לדיווחים יומיים באופן שווה בין א׳–ה׳');
                setTimeout(() => { showScreen('main'); clearReportForm(); loadReports(currentUser.uid); }, 1200);
            }).catch((error) => showError('שגיאה בשמירת הדיווח: ' + error.message));
            return;
        }

        if (!currentUser) return;
        const reportKey = isWeekly ? `weekly_${getCurrentWeekForStorage()}` : `daily_${reportData.date}`;
        database.ref('reports/' + currentUser.uid + '/' + reportKey).set(reportData).then(() => {
            showPopup('הדיווח נוסף בהצלחה!');
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
    function addNewReport() {
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
        document.querySelectorAll('#report-type-toggle .toggle-option').forEach(o => o.classList.remove('active'));
        const sel = document.querySelector(`#report-type-toggle .toggle-option[data-type="${type}"]`);
        if (sel) sel.classList.add('active');
        toggleHidden('daily-form', type !== 'daily');
        toggleHidden('weekly-form', type !== 'weekly');
        if (type === 'weekly') {
            setInputValue('report-week', getCurrentWeek());
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
        const baseList = (Array.isArray(activeResearchers) && activeResearchers.length > 0) ? activeResearchers : allResearchers;
        const available = [...(baseList || []), 'משימות אחרות', 'סמינר / קורס / הכשרה'];
        entryDiv.innerHTML = `
            ${container.children.length > 0 ? '<button class="remove-btn" onclick="removeEntry(this)">×</button>' : ''}
            <div class="form-group">
                <label>בחר חוקר/משימה:</label>
                <select class="researcher-select" onchange="toggleDetailField(this)">
                    ${available.map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
            </div>
            <div class="form-group detail-field" style="display: none;">
                <label>פרט:</label>
                <textarea rows="2" placeholder="הוסף פרטים נוספים..."></textarea>
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
        const baseList = (Array.isArray(activeResearchers) && activeResearchers.length > 0) ? activeResearchers : allResearchers;
        const available = [...(baseList || []), 'משימות אחרות', 'סמינר / קורס / הכשרה'];
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
                <textarea rows="2" placeholder="הוסף פרטים נוספים..."></textarea>
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

    function refreshResearcherDropdowns() {
        const baseList = (Array.isArray(activeResearchers) && activeResearchers.length > 0) ? activeResearchers : allResearchers;
        const available = [...(baseList || []), 'משימות אחרות', 'סמינר / קורס / הכשרה'];
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
            // Mark day if there is a daily report or it is covered by a weekly report (Sun–Thu)
            const hasDailyReport = reports.some(r => r.type === 'daily' && r.date === dateString);
            const isWeekday = date.getDay() >= 0 && date.getDay() <= 4; // Sun–Thu
            const coveredByWeekly = isWeekday && reports.some(r => r.type === 'weekly' && r.weekStart && r.weekEnd && (dateString >= r.weekStart) && (dateString <= r.weekEnd));
            if (hasDailyReport || coveredByWeekly) div.classList.add('has-report');
            if (date.getDay() === 5 || date.getDay() === 6) {
                div.style.background = 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)';
                div.style.color = '#9ca3af';
            }
            div.addEventListener('click', () => {
                if (date.getDay() === 5 || date.getDay() === 6) { showError('לא ניתן להוסיף דיווח לימי שישי ושבת'); return; }
                document.querySelectorAll('.calendar-day.selected').forEach(dv => dv.classList.remove('selected'));
                div.classList.add('selected');
                selectedDate = date;
            });
            grid.appendChild(div);
        }
    }
    window.previousMonth = function () { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderCalendar(); };
    window.nextMonth = function () { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderCalendar(); };

    function addCalendarReport() {
        if (!selectedDate) { showError('אנא בחר תאריך'); return; }
        const now = new Date();
        const weekStart = getWeekStart(now);
        if (selectedDate < weekStart) {
            if (reports.some(r => r.date === formatDate(selectedDate))) { showError('לא ניתן לערוך דיווח קיים'); return; }
        }
        // Ensure we're using the correct date format and set it properly
        const formattedDate = formatDate(selectedDate);
        setInputValue('report-date', formattedDate);
        showScreen('daily-report');
        // Ensure there is at least one daily entry by default
        selectWorkStatus('worked');
    }
    window.addCalendarReport = addCalendarReport;

    // ---------- Reports Screen ----------
    function initializeReportScreen() {
        const yearSelect = document.getElementById('report-year');
        const nowY = new Date().getFullYear();
        yearSelect.innerHTML = '';
        for (let y = nowY - 2; y <= nowY + 1; y++) { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; if (y === nowY) opt.selected = true; yearSelect.appendChild(opt); }
        document.getElementById('report-month').value = (new Date().getMonth() + 1);
        // Auto-generate on open so user sees fresh daily reports immediately
        try { generateReport(); } catch (_) {}
    }

    function generateReport() {
        const month = parseInt(getInputValue('report-month'));
        const year = parseInt(getInputValue('report-year'));
        const resultsDiv = document.getElementById('report-results');
        // Show only daily entries to prevent double counting (weekly is fan-out)
        const monthReports = reports.filter(r => {
            if (r.type !== 'daily' || !r.date) return false;
            const [y, m, d] = r.date.split('-').map(Number);
            const dt = new Date(y, m - 1, d);
            return dt.getMonth() + 1 === month && dt.getFullYear() === year;
        });
        if (monthReports.length === 0) { resultsDiv.innerHTML = '<div class="notification">לא נמצאו דיווחים לחודש שנבחר</div>'; return; }
        let html = '<h3>דוח חודשי</h3>'; let totalHours = 0; let totalDays = 0; const summary = {};
        monthReports.forEach(report => {
            html += `<div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">`;
            if (report.type === 'daily' && report.date) {
                const [yearStr, monthStr, dayStr] = report.date.split('-').map(Number);
                const d = new Date(yearStr, monthStr - 1, dayStr);
                html += `<h4><span class="material-symbols-outlined" style="vertical-align: middle; color:#2563eb; margin-left:6px;">calendar_today</span>${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}</h4>`;
                if (report.workStatus === 'no-work') { html += '<p>לא עבד</p>'; } else {
                    (report.entries || []).forEach(e => {
                        html += `<p><span class="material-symbols-outlined" style="font-size:18px; vertical-align: middle; color:#059669; margin-left:6px;">schedule</span>${e.researcher}: ${e.hours} שעות${e.detail ? ' - ' + e.detail : ''}</p>`;
                        totalHours += e.hours; summary[e.researcher] = summary[e.researcher] || { hours: 0, days: 0 }; summary[e.researcher].hours += e.hours;
                    });
                }
            } else if (report.type === 'weekly') {
                const rangeLabel = report.week || `${(report.weekStart || '').split('-').reverse().join('/')} - ${(report.weekEnd || '').split('-').reverse().join('/')}`;
                html += `<h4><span class="material-symbols-outlined" style="vertical-align: middle; color:#7c3aed; margin-left:6px;">event</span>${rangeLabel}</h4>`;
                (report.entries || []).forEach(e => {
                    const hours = (Number(e.days || 0) || 0) * (window.APP_CONFIG?.hoursPerDay || 8);
                    html += `<p><span class="material-symbols-outlined" style="font-size:18px; vertical-align: middle; color:#059669; margin-left:6px;">schedule</span>${e.researcher}: ${e.days} ימים (${hours} שעות)${e.detail ? ' - ' + e.detail : ''}</p>`;
                    totalDays += e.days; totalHours += hours; summary[e.researcher] = summary[e.researcher] || { hours: 0, days: 0 }; summary[e.researcher].days += e.days; summary[e.researcher].hours += hours;
                });
            }
            html += '</div>';
        });
        html += '<div style="margin-top: 30px; padding: 20px; background-color: #f9fafb; border-radius: 8px; border:1px dashed #e5e7eb;">';
        html += `<h3><span class="material-symbols-outlined" style="vertical-align: middle; color:#2563eb; margin-left:6px;">insights</span>סיכום חודשי</h3><p><strong>סה"כ שעות: ${totalHours}</strong></p><p><strong>סה"כ ימים: ${totalDays}</strong></p><h4 style="margin-top:12px;">פילוח לפי חוקר/פרויקט:</h4>`;
        Object.entries(summary).forEach(([name, s]) => { html += `<p><span class="material-symbols-outlined" style="font-size:18px; vertical-align: middle; color:#6b7280; margin-left:6px;">person</span>${name}: ${s.hours > 0 ? s.hours + ' שעות ' : ''}${s.days > 0 ? s.days + ' ימים' : ''}</p>`; });
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
                html += `<div class="missing-report-item">
                    <span class="missing-day">${dayName}</span>
                    <span class="missing-date">${dateStr}</span>
                    <span class="missing-status">חסר דיווח</span>
                </div>`;
            });
            html += '</div>';
            missingDiv.innerHTML = html;
        }
    }

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
        const inputs = document.querySelectorAll('#user-profile-screen input');
        if (!inputs || inputs.length === 0) return;
        const isReadonly = inputs[0].hasAttribute('readonly');
        inputs.forEach(el => { if (isReadonly) el.removeAttribute('readonly'); else el.setAttribute('readonly', 'readonly'); });
        const btn = document.querySelector('#user-profile-screen .btn');
        if (btn) btn.textContent = isReadonly ? 'שמור' : 'ערוך';
        if (!isReadonly) {
            const data = { firstName: getInputValue('profile-first-name'), lastName: getInputValue('profile-last-name'), position: getInputValue('profile-position'), email: getInputValue('profile-email') };
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
            const err = { code: 'auth/email-domain-not-allowed', message: 'כתובת האימייל חייבת להיות בדומיין volcani.agri.gov.il' };
            return Promise.reject(err);
        }
        return auth.signInWithEmailAndPassword(email, password);
    }

    function createUser(data) {
        if (!isAllowedDomain(data.email)) {
            const err = { code: 'auth/email-domain-not-allowed', message: 'כתובת האימייל חייבת להיות בדומיין volcani.agri.gov.il' };
            return Promise.reject(err);
        }
        return auth.createUserWithEmailAndPassword(data.email, data.password).then(async (cred) => {
            const uid = cred.user.uid;
            await database.ref('users/' + uid).set({ firstName: data.firstName, lastName: data.lastName, position: data.position, email: data.email, createdAt: new Date().toISOString() }).catch(() => {});
            return cred;
        });
    }

    // Allow resending verification from login screen
    window.resendVerificationFromLogin = async function () {
        const email = getInputValue('login-email');
        const password = getInputValue('login-password');
        if (!email || !password) { setHTML('login-messages', '<div class="error-message">הזן אימייל וסיסמה כדי לשלוח אימות מחדש</div>'); return; }
        if (!isAllowedDomain(email)) { setHTML('login-messages', '<div class="error-message">כתובת האימייל חייבת להיות בדומיין volcani.agri.gov.il</div>'); return; }
        try {
            const cred = await auth.signInWithEmailAndPassword(email, password);
            setHTML('login-messages', '<div class="success-message">התחברת בהצלחה</div>');
        } catch (err) {
            setHTML('login-messages', `<div class=\"error-message\">${translateErrorMessage(err)}</div>`);
        }
    };

    function translateErrorMessage(error) {
        const errorMessages = {
            'auth/invalid-email': 'כתובת האימייל אינה חוקית',
            'auth/user-disabled': 'המשתמש הושבת',
            'auth/user-not-found': 'משתמש לא נמצא',
            'auth/wrong-password': 'סיסמה שגויה',
            'auth/weak-password': 'סיסמה חלשה מדי',
            'auth/email-already-in-use': 'האימייל כבר רשום במערכת',
            'auth/email-domain-not-allowed': 'רק מייל בדומיין volcani.agri.gov.il מורשה',
            'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שוב מאוחר יותר'
        };
        return errorMessages[error.code] || error.message;
    }

    // ---------- Helpers ----------
    function setInputValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
    function getInputValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }
    function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
    function toggleHidden(id, isHidden) { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', isHidden); }
    function showPopup(message, type = 'success') { const popup = document.createElement('div'); popup.className = 'popup'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-live', 'assertive'); popup.setAttribute('aria-modal', 'true'); const innerClass = type === 'error' ? 'error-message' : 'success-message'; popup.innerHTML = `<div class="popup-content"><div class="${innerClass}">${message}</div></div>`; document.body.appendChild(popup); setTimeout(() => { if (popup.parentNode) document.body.removeChild(popup); }, 2000); }
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
    function getWeekStart(date) { const d = new Date(date); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); return new Date(d.setDate(diff)); }
    function getSundayOfWeek(date) { const d = new Date(date); const day = d.getDay(); const diff = d.getDate() - day; return new Date(d.setDate(diff)); }
    function roundToHalf(num) { return Math.round(num * 2) / 2; }
    function initializeDates() { const today = new Date(); currentMonth = today.getMonth(); currentYear = today.getFullYear(); currentWeek = getCurrentWeek(); }
    function renderWeeklyDatesHint() {
        const hintEl = document.getElementById('weekly-dates-hint');
        if (!hintEl) return;
        const today = new Date();
        const sunday = getSundayOfWeek(today);
        const thursday = new Date(sunday);
        thursday.setDate(sunday.getDate() + 4);
        const startDate = `${String(sunday.getDate()).padStart(2,'0')}/${String(sunday.getMonth()+1).padStart(2,'0')}/${sunday.getFullYear()}`;
        const endDate = `${String(thursday.getDate()).padStart(2,'0')}/${String(thursday.getMonth()+1).padStart(2,'0')}/${thursday.getFullYear()}`;
        hintEl.textContent = `טווח התאריכים: ${startDate} - ${endDate} (א׳–ה׳)`;
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
        const resetForm = document.getElementById('reset-password-form');
        if (resetForm) resetForm.addEventListener('submit', function (e) {
            e.preventDefault(); const email = getInputValue('reset-email'); auth.sendPasswordResetEmail(email).then(() => setHTML('forgot-password-messages', '<div class="success-message">קישור לשחזור סיסמה נשלח למייל שלך</div>')).catch(err => setHTML('forgot-password-messages', `<div class="error-message">${translateErrorMessage(err)}</div>`));
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
        // Do not auto-add entries here; entries are created when opening the report screen
        // setTimeout(() => { addWorkEntry(); }, 100);
    });
})();
