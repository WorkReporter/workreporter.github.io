// Admin-only analytics and CSV, including allocation logic
(function () {
    const { hoursPerDay } = window.APP_CONFIG;
    let adminChart = null;
    let allReportsByUser = null;
    let activeByUser = null; // { uid: [activeResearchers] }

    function isAdminUser() {
        const state = window.getAppState ? window.getAppState() : {};
        return !!(state && state.isAdmin);
    }

    function loadAllReportsForAdmin() {
        if (!isAdminUser()) return Promise.resolve();
        return Promise.all([
            window.database.ref('reports').once('value'),
            window.database.ref('users').once('value')
        ]).then(([repSnap, usersSnap]) => {
            allReportsByUser = repSnap.val() || {};
            const users = usersSnap.val() || {};
            activeByUser = {};
            Object.entries(users).forEach(([uid, u]) => {
                if (u && Array.isArray(u.activeResearchers)) {
                    activeByUser[uid] = u.activeResearchers;
                } else {
                    activeByUser[uid] = [];
                }
            });
        });
    }

    function aggregateMonthHoursWithAllocation(month, year) {
        // For each user: split 'משימות אחרות' evenly across that user's activeResearchers
        // 'סמינר / קורס / הכשרה' stays separate under that label (admin overhead)
        const totals = {}; // researcherName -> hours

        if (!allReportsByUser) return totals;
        const activeByUserCache = {};

        const processEntry = (report, entry, userActive) => {
            if (!entry || !entry.researcher) return;
            const type = report.type;
            if (entry.researcher === 'סמינר / קורס / הכשרה') {
                // count as overhead
                const hours = type === 'daily' ? (entry.hours || 0) : (entry.days || 0) * hoursPerDay;
                totals[entry.researcher] = (totals[entry.researcher] || 0) + hours;
                return;
            }
            if (entry.researcher === 'משימות אחרות') {
                const allocationTargets = Array.isArray(userActive) && userActive.length > 0 ? userActive : [];
                if (allocationTargets.length === 0) return; // nothing to split
                const hours = type === 'daily' ? (entry.hours || 0) : (entry.days || 0) * hoursPerDay;
                const portion = hours / allocationTargets.length;
                allocationTargets.forEach(name => { totals[name] = (totals[name] || 0) + portion; });
                return;
            }
            const hours = type === 'daily' ? (entry.hours || 0) : (entry.days || 0) * hoursPerDay;
            totals[entry.researcher] = (totals[entry.researcher] || 0) + hours;
        };

        Object.entries(allReportsByUser).forEach(([uid, userReports]) => {
            if (!userReports) return;
            const userActive = (activeByUser && activeByUser[uid]) ? activeByUser[uid] : [];

            Object.values(userReports).forEach((report) => {
                if (!report || !report.date) return;
                const d = new Date(report.date);
                if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return;
                const entries = Array.isArray(report.entries) ? report.entries : [];
                entries.forEach(entry => processEntry(report, entry, userActive));
            });
        });

        return totals;
    }

    function generateAdminAnalytics() {
        if (!isAdminUser()) return;
        const m = parseInt(document.getElementById('admin-month').value);
        const y = parseInt(document.getElementById('admin-year').value);
        const shouldAllocateOthers = document.getElementById('admin-allocate-others').checked;

        const compute = () => {
            let totals = {};
            if (shouldAllocateOthers) {
                totals = aggregateMonthHoursWithAllocation(m, y);
            } else {
                // No allocation: simple sum per researcher label across all users
                totals = {};
                if (allReportsByUser) {
                    Object.values(allReportsByUser).forEach(userReports => {
                        Object.values(userReports || {}).forEach(report => {
                            const d = new Date(report.date);
                            if (d.getMonth() + 1 !== m || d.getFullYear() !== y) return;
                            (report.entries || []).forEach(entry => {
                                if (!entry || !entry.researcher) return;
                                const hours = report.type === 'daily' ? (entry.hours || 0) : (entry.days || 0) * hoursPerDay;
                                totals[entry.researcher] = (totals[entry.researcher] || 0) + hours;
                            });
                        });
                    });
                }
            }
            renderChartAndStats(totals);
        };

        if (!allReportsByUser) {
            loadAllReportsForAdmin().then(compute);
        } else {
            compute();
        }
    }
    window.generateAdminAnalytics = generateAdminAnalytics;

    function renderChartAndStats(byResearcher) {
        const labels = Object.keys(byResearcher);
        const data = Object.values(byResearcher);
        const ctx = document.getElementById('admin-pie').getContext('2d');
        if (adminChart) adminChart.destroy();
        adminChart = new Chart(ctx, { type: 'pie', data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => `hsl(${(i*47)%360} 70% 60%)`) }] }, options: { plugins: { legend: { position: 'bottom' } } } });
        const total = data.reduce((a,b)=>a+b,0);
        let html = '<div style="padding:15px; background:#f9fafb; border-radius:6px;">';
        html += `<p><strong>סה"כ שעות (חודשי): ${total}</strong></p>`;
        html += '<h4 style="margin-top:10px;">פילוח לפי חוקר:</h4>';
        labels.forEach((label, idx) => { html += `<p>${label}: ${data[idx]} שעות</p>`; });
        html += '</div>';
        document.getElementById('admin-stats').innerHTML = html;
    }

    function downloadAdminCsv() {
        if (!isAdminUser()) return;
        const m = parseInt(document.getElementById('admin-month').value);
        const y = parseInt(document.getElementById('admin-year').value);
        const shouldAllocateOthers = document.getElementById('admin-allocate-others').checked;
        const done = (totals) => {
            const rows = [['Researcher','TotalHours(month)']];
            Object.entries(totals).forEach(([name, hours]) => rows.push([name, hours]));
            downloadCsv(`admin-monthly-${y}-${String(m).padStart(2,'0')}.csv`, rows);
        };
        if (!allReportsByUser) {
            loadAllReportsForAdmin().then(() => done(shouldAllocateOthers ? aggregateMonthHoursWithAllocation(m, y) : aggregateMonthHoursWithAllocation(m, y)));
        } else {
            done(shouldAllocateOthers ? aggregateMonthHoursWithAllocation(m, y) : aggregateMonthHoursWithAllocation(m, y));
        }
    }
    window.downloadAdminCsv = downloadAdminCsv;

    function downloadCsv(filename, rows) {
        const csv = rows.map(r => r.map(v => {
            const s = String(v ?? '');
            if (s.includes('"') || s.includes(',') || s.includes('\n')) return '"' + s.replace(/"/g,'""') + '"';
            return s;
        }).join(',')).join('\n');
        const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // Researchers global list admin editing
    function loadResearchersToTextarea() {
        if (!isAdminUser()) return;
        window.database.ref('global/researchers').once('value').then(snap => {
            const list = snap.val() || [];
            const ta = document.getElementById('admin-researchers-textarea');
            if (ta) ta.value = (list || []).join('\n');
        });
    }
    window.loadResearchersToTextarea = loadResearchersToTextarea;

    function saveResearchersFromTextarea() {
        if (!isAdminUser()) return;
        const ta = document.getElementById('admin-researchers-textarea');
        if (!ta) return;
        const list = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        
        // Save to Firebase
        window.database.ref('global/researchers').set(list).then(() => {
            // refresh currently loaded list in app state
            const state = window.getAppState();
            if (state) state.allResearchers = list;
            window.renderResearchers?.();
            
            // Also update the JSON file (this would require a server endpoint in a real app)
            console.log('Researchers updated in Firebase. To update JSON file, contact administrator.');
        });
    }
    window.saveResearchersFromTextarea = saveResearchersFromTextarea;
})();

