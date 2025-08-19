// Core app logic (auth, screens, reports, calendar, user flows)

(function () {
    const { firebaseConfig, adminEmail, hoursPerDay, defaultResearchers } = window.APP_CONFIG;

    // Initialize Firebase (idempotent)
    if (!window._firebaseInitialized) {
        firebase.initializeApp(firebaseConfig);
        window._firebaseInitialized = true;
    }

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

    // Expose for admin module and UI
    window.getAppState = function () {
        return { currentUser, isAdmin, activeResearchers, allResearchers, reports, currentMonth, currentYear, selectedDate, currentWeek };
    };
    window.setIsAdmin = function (v) { isAdmin = v; updateAdminUI(); };

    // ---------- Auth Flow ----------
    function init() {
        auth.onAuthStateChanged((user) => {
            if (user) {
                currentUser = user;
                isAdmin = String(user.email || '').toLowerCase() === String(adminEmail).toLowerCase();
                setAuthUIState(true);
                initializeDates();
                Promise.all([
                    ensureGlobalResearchersSeed(),
                    loadUserProfile(user.uid),
                    loadActiveResearchers(user.uid),
                    loadReports(user.uid)
                ]).then(() => {
                    updateAdminUI();
                    updateNotifications();
                    showScreen('main');
                }).catch(() => {
                    showScreen('main');
                });
            } else {
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
        const screens = ['login', 'main', 'user-profile', 'active-researchers', 'calendar', 'reports', 'daily-report', 'admin'];
        screens.forEach(screen => {
            const el = document.getElementById(screen + '-screen');
            if (el) el.classList.add('hidden');
        });
        const target = document.getElementById(screenName + '-screen');
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`.nav-btn[onclick="showScreen('${screenName}')"]`);
        if (btn) btn.classList.add('active');

        if (screenName === 'calendar') renderCalendar();
        if (screenName === 'reports') initializeReportScreen();
        if (screenName === 'active-researchers') renderResearchers();
        if (screenName === 'main') updateNotifications();
        if (screenName === 'admin') initializeAdminScreen();
    }

    window.showScreen = showScreen;

    function logout() {
        auth.signOut().catch(() => {}).finally(() => {
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
    function ensureGlobalResearchersSeed() {
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
        return database.ref('users/' + uid + '/activeResearchers').once('value').then(snap => {
            const data = snap.val();
            if (Array.isArray(data) && data.length > 0) {
                activeResearchers = data;
            } else {
                // default: first 5 from global list
                activeResearchers = (allResearchers || []).slice(0, 5);
            }
        }).catch(() => {
            activeResearchers = (allResearchers || []).slice(0, 5);
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
        if (!reportDate) { alert('אנא הזן תאריך'); return; }
        const d = new Date(reportDate);
        if (d.getDay() === 5 || d.getDay() === 6) { alert('לא ניתן לדווח עבודה בימי שישי ושבת'); return; }

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
            const week = getInputValue('report-week');
            reportData.week = week;
            document.querySelectorAll('#weekly-entries .work-entry').forEach(entry => {
                const researcher = entry.querySelector('.researcher-select')?.value || '';
                const days = parseFloat(entry.querySelector('.days-input')?.value || '0') || 0;
                const detail = (entry.querySelector('textarea')?.value) || '';
                if (researcher && days > 0) reportData.entries.push({ researcher, days, detail });
            });
        }

        if (!currentUser) return;
        const reportKey = isWeekly ? `weekly_${reportData.week}` : `daily_${reportData.date}`;
        database.ref('reports/' + currentUser.uid + '/' + reportKey).set(reportData).then(() => {
            showPopup('הדיווח נוסף בהצלחה!');
            setTimeout(() => { showScreen('main'); clearReportForm(); loadReports(currentUser.uid); }, 1200);
        }).catch((error) => alert('שגיאה בשמירת הדיווח: ' + error.message));
    }
    window.submitReport = submitReport;

    // ---------- UI: Daily/Weekly Entries ----------
    function addNewReport() {
        const today = new Date();
        setInputValue('report-date', formatDate(today));
        const dayOfWeek = today.getDay();
        const weeklyToggle = document.querySelector('[data-type="weekly"]');
        if (weeklyToggle) weeklyToggle.style.display = (dayOfWeek === 4) ? 'block' : 'none';
        selectReportType('daily');
        showScreen('daily-report');
    }
    window.addNewReport = addNewReport;

    function selectReportType(type) {
        document.querySelectorAll('#report-type-toggle .toggle-option').forEach(o => o.classList.remove('active'));
        const sel = document.querySelector(`#report-type-toggle .toggle-option[data-type="${type}"]`);
        if (sel) sel.classList.add('active');
        toggleHidden('daily-form', type !== 'daily');
        toggleHidden('weekly-form', type !== 'weekly');
        if (type === 'weekly') setInputValue('report-week', getCurrentWeek());
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
            document.querySelector('.btn.add')?.style && (document.querySelector('.btn.add').style.display = 'none');
            updateTotalHours();
        } else {
            workEntries.style.display = 'block';
            document.querySelector('.btn.add')?.style && (document.querySelector('.btn.add').style.display = 'block');
            if (workEntries.children.length === 0) addWorkEntry();
        }
    }
    window.selectWorkStatus = selectWorkStatus;

    function addWorkEntry() {
        const container = document.getElementById('work-entries');
        if (!container) return;
        const entryDiv = document.createElement('div');
        entryDiv.className = 'work-entry';
        const available = [...(activeResearchers || []), 'משימה אחרות', 'סמינר / קורס / הכשרה'];
        entryDiv.innerHTML = `
            ${container.children.length > 0 ? '<button class="remove-btn" onclick="removeEntry(this)">×</button>' : ''}
            <div class="form-group">
                <label>חוקר/משימה:</label>
                <select class="researcher-select" onchange="toggleDetailField(this)">
                    <option value="">בחר חוקר/משימה</option>
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
        const available = [...(activeResearchers || []), 'משימה אחרות', 'סמינר / קורס / הכשרה'];
        entryDiv.innerHTML = `
            ${container.children.length > 0 ? '<button class="remove-btn" onclick="removeEntry(this)">×</button>' : ''}
            <div class="form-group">
                <label>חוקר/פרויקט:</label>
                <select class="researcher-select" onchange="toggleDetailField(this)">
                    <option value="">בחר חוקר/פרויקט</option>
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
    window.addWeeklyEntry = addWeeklyEntry;

    function toggleDetailField(selectElement) {
        const entry = selectElement.closest('.work-entry');
        const detailField = entry.querySelector('.detail-field');
        const val = selectElement.value;
        if (val === 'משימה אחרות' || val === 'סמינר / קורס / הכשרה') {
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
            if (reports.some(r => r.date === dateString)) div.classList.add('has-report');
            if (date.getDay() === 5 || date.getDay() === 6) { div.style.backgroundColor = '#f3f4f6'; div.style.color = '#9ca3af'; }
            div.addEventListener('click', () => {
                if (date.getDay() === 5 || date.getDay() === 6) return;
                document.querySelectorAll('.calendar-day.selected').forEach(dv => dv.classList.remove('selected'));
                div.classList.add('selected'); selectedDate = date;
            });
            grid.appendChild(div);
        }
    }
    window.previousMonth = function () { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderCalendar(); };
    window.nextMonth = function () { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderCalendar(); };

    function addCalendarReport() {
        if (!selectedDate) { alert('אנא בחר תאריך'); return; }
        const now = new Date();
        const weekStart = getWeekStart(now);
        if (selectedDate < weekStart) {
            if (reports.some(r => r.date === formatDate(selectedDate))) { alert('לא ניתן לערוך דיווח קיים'); return; }
        }
        setInputValue('report-date', formatDate(selectedDate));
        showScreen('daily-report');
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
        const monthReports = reports.filter(r => { const d = new Date(r.date); return d.getMonth() + 1 === month && d.getFullYear() === year; });
        if (monthReports.length === 0) { resultsDiv.innerHTML = '<div class="notification">לא נמצאו דיווחים לחודש שנבחר</div>'; return; }
        let html = '<h3>דוח חודשי</h3>'; let totalHours = 0; let totalDays = 0; const summary = {};
        monthReports.forEach(report => {
            const d = new Date(report.date);
            html += `<div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">`;
            html += `<h4>${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}</h4>`;
            if (report.type === 'daily') {
                if (report.workStatus === 'no-work') { html += '<p>לא עבד</p>'; } else {
                    (report.entries || []).forEach(e => {
                        html += `<p>${e.researcher}: ${e.hours} שעות${e.detail ? ' - ' + e.detail : ''}</p>`;
                        totalHours += e.hours; summary[e.researcher] = summary[e.researcher] || { hours: 0, days: 0 }; summary[e.researcher].hours += e.hours;
                    });
                }
            } else {
                (report.entries || []).forEach(e => {
                    html += `<p>${e.researcher}: ${e.days} ימים${e.detail ? ' - ' + e.detail : ''}</p>`;
                    totalDays += e.days; summary[e.researcher] = summary[e.researcher] || { hours: 0, days: 0 }; summary[e.researcher].days += e.days;
                });
            }
            html += '</div>';
        });
        html += '<div style="margin-top: 30px; padding: 20px; background-color: #f9fafb; border-radius: 5px;">';
        html += `<h3>סיכום חודשי</h3><p><strong>סה"כ שעות: ${totalHours}</strong></p><p><strong>סה"כ ימים: ${totalDays}</strong></p><h4>פילוח לפי חוקר/פרויקט:</h4>`;
        Object.entries(summary).forEach(([name, s]) => { html += `<p>${name}: ${s.hours > 0 ? s.hours + ' שעות ' : ''}${s.days > 0 ? s.days + ' ימים' : ''}</p>`; });
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
        const weekStart = getWeekStart(today);
        const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
        const missing = [];
        for (let i = 0; i < 5; i++) { // Mon-Fri
            const checkDate = new Date(weekStart); checkDate.setDate(weekStart.getDate() + i);
            if (checkDate <= today) {
                const dateString = formatDate(checkDate);
                const hasDaily = reports.some(r => r.type === 'daily' && r.date === dateString);
                if (!hasDaily) missing.push(checkDate);
            }
        }
        // Cap to 4 messages, reset each Sunday implicitly as we compute per current week
        const limited = missing.slice(0, 4);
        if (limited.length > 0) {
            const text = limited.map(d => `${dayNames[d.getDay()]} (${d.getDate()}/${d.getMonth() + 1})`).join(', ');
            missingDiv.innerHTML = `<div class="notification"><strong>חסרים דיווחים עבור:</strong><br>${text}</div>`;
        }
    }

    // ---------- Researchers UI ----------
    function renderResearchers() {
        const container = document.getElementById('researchers-list');
        if (!container) return;
        container.innerHTML = '';
        (allResearchers || []).forEach(name => {
            const div = document.createElement('div');
            div.className = 'researcher-item';
            const id = `researcher-${name}`;
            const checked = activeResearchers.includes(name) ? 'checked' : '';
            div.innerHTML = `<input type="checkbox" id="${id}" ${checked}><label for="${id}">${name}</label>`;
            container.appendChild(div);
        });
        ['משימה אחרות', 'סמינר / קורס / הכשרה'].forEach(item => {
            const div = document.createElement('div');
            div.className = 'researcher-item';
            div.innerHTML = `<input type="checkbox" checked disabled><label>${item}</label>`;
            container.appendChild(div);
        });
    }
    window.renderResearchers = renderResearchers;

    function saveResearchers() {
        activeResearchers = [];
        document.querySelectorAll('#researchers-list input[type="checkbox"]:checked:not([disabled])').forEach(cb => {
            const name = cb.id.replace('researcher-', '');
            activeResearchers.push(name);
        });
        if (currentUser) {
            database.ref('users/' + currentUser.uid + '/activeResearchers').set(activeResearchers).then(() => showPopup('החוקרים הפעילים נשמרו בהצלחה'));
        }
    }
    window.saveResearchers = saveResearchers;

    // ---------- Profile UI ----------
    function editProfile() {
        const inputs = document.querySelectorAll('#user-profile-screen input');
        if (!inputs || inputs.length === 0) return;
        const isReadonly = inputs[0].hasAttribute('readonly');
        if (isReadonly) {
            inputs.forEach(input => {
                if (input.type !== 'password' && input.type !== 'email') { input.removeAttribute('readonly'); input.style.backgroundColor = 'white'; }
            });
            document.querySelector('#user-profile-screen .btn').textContent = 'שמור';
        } else {
            const updated = { firstName: getInputValue('profile-first-name'), lastName: getInputValue('profile-last-name'), position: getInputValue('profile-position') };
            updateUserProfile(currentUser.uid, updated).then(() => {
                inputs.forEach(input => { input.setAttribute('readonly', true); input.style.backgroundColor = '#f9fafb'; });
                document.querySelector('#user-profile-screen .btn').textContent = 'ערוך';
                showPopup('הפרטים עודכנו בהצלחה!');
            });
        }
    }
    window.editProfile = editProfile;

    // ---------- Auth Forms ----------
    function switchAuthTab(tabType) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.querySelector(`[onclick="switchAuthTab('${tabType}')"]`)?.classList.add('active');
        document.getElementById(`${tabType}-form`)?.classList.add('active');
        setHTML('login-messages', ''); setHTML('register-messages', '');
        document.getElementById('forgot-password-form')?.classList.remove('active');
    }
    window.switchAuthTab = switchAuthTab;

    function showForgotPassword() {
        document.getElementById('login-form')?.classList.remove('active');
        document.getElementById('forgot-password-form')?.classList.add('active');
    }
    window.showForgotPassword = showForgotPassword;

    function backToLogin() {
        document.getElementById('forgot-password-form')?.classList.remove('active');
        document.getElementById('login-form')?.classList.add('active');
    }
    window.backToLogin = backToLogin;

    function createUser(userData) {
        return auth.createUserWithEmailAndPassword(userData.email, userData.password).then((cred) => {
            const uid = cred.user.uid;
            const profile = { firstName: userData.firstName, lastName: userData.lastName, position: userData.position, email: userData.email, createdAt: firebase.database.ServerValue.TIMESTAMP };
            return database.ref('users/' + uid).set(profile);
        });
    }

    function signInUser(email, password) { return auth.signInWithEmailAndPassword(email, password); }

    // ---------- Helpers ----------
    function setInputValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
    function getInputValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }
    function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
    function toggleHidden(id, isHidden) { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', isHidden); }
    function showPopup(message) { const popup = document.createElement('div'); popup.className = 'popup'; popup.innerHTML = `<div class="popup-content"><div class="success-message">${message}</div></div>`; document.body.appendChild(popup); setTimeout(() => document.body.removeChild(popup), 1500); }
    function formatDate(date) { return date.toISOString().split('T')[0]; }
    function getCurrentWeek() { const now = new Date(); const year = now.getFullYear(); const week = Math.ceil((((now - new Date(year, 0, 1)) / 86400000) + new Date(year, 0, 1).getDay() + 1) / 7); return `${year}-W${week.toString().padStart(2, '0')}`; }
    function getWeekStart(date) { const d = new Date(date); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); return new Date(d.setDate(diff)); }
    function initializeDates() { const today = new Date(); currentMonth = today.getMonth(); currentYear = today.getFullYear(); currentWeek = getCurrentWeek(); }

    // Expose for admin.js
    window.updateAdminUI = function () {
        const adminNavBtn = document.getElementById('admin-nav-btn');
        if (adminNavBtn) adminNavBtn.style.display = isAdmin ? '' : 'none';
    };
    window.initializeAdminScreen = function () { if (!isAdmin) return; const yearSelect = document.getElementById('admin-year'); const nowY = new Date().getFullYear(); yearSelect.innerHTML = ''; for (let y = nowY - 2; y <= nowY + 1; y++) { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; if (y === nowY) opt.selected = true; yearSelect.appendChild(opt); } document.getElementById('admin-month').value = new Date().getMonth() + 1; };

    // ---------- Event listeners ----------
    document.addEventListener('DOMContentLoaded', function () {
        // toggles
        document.querySelectorAll('#report-type-toggle .toggle-option').forEach(option => option.addEventListener('click', function () { selectReportType(this.dataset.type); }));
        document.querySelectorAll('#work-status-toggle .toggle-option').forEach(option => option.addEventListener('click', function () { selectWorkStatus(this.dataset.status); }));
        // auth forms
        const signin = document.getElementById('signin-form');
        if (signin) signin.addEventListener('submit', function (e) {
            e.preventDefault(); const email = getInputValue('login-email'); const pwd = getInputValue('login-password');
            signInUser(email, pwd).catch(err => setHTML('login-messages', `<div class="error-message">${err.message}</div>`));
        });
        const signup = document.getElementById('signup-form');
        if (signup) signup.addEventListener('submit', function (e) {
            e.preventDefault();
            const data = { firstName: getInputValue('register-first-name'), lastName: getInputValue('register-last-name'), position: getInputValue('register-position'), email: getInputValue('register-email'), password: getInputValue('register-password') };
            const confirm = getInputValue('register-confirm-password');
            if (data.password !== confirm) { setHTML('register-messages', '<div class="error-message">סיסמאות אינן תואמות</div>'); return; }
            createUser(data).then(() => signInUser(data.email, data.password)).catch(err => setHTML('register-messages', `<div class="error-message">${err.message}</div>`));
        });
        const resetForm = document.getElementById('reset-password-form');
        if (resetForm) resetForm.addEventListener('submit', function (e) {
            e.preventDefault(); const email = getInputValue('reset-email'); auth.sendPasswordResetEmail(email).then(() => setHTML('forgot-password-messages', '<div class="success-message">קישור לשחזור סיסמה נשלח למייל שלך</div>')).catch(err => setHTML('forgot-password-messages', `<div class="error-message">${err.message}</div>`));
        });

        // initial
        init();
        setTimeout(() => { addWorkEntry(); }, 100);
    });
})();

