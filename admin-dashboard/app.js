// Firebase Admin Dashboard (client-only, secured by Realtime Database Security Rules)
// Assumptions:
// - Realtime Database structure:
//   users/{uid} => { firstName, lastName, position, email, createdAt }
//   reports/{uid}/{reportId} => { date: ISO string or yyyy-mm-dd, category: string, hours: number, description?: string }
// - Admin detection is done by attempting to read the protected path 'users' root.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut as firebaseSignOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, get, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyDpzAnHPl8trZDQwC-G5twRWSwdweko_T8",
  authDomain: "work-report-volcani.firebaseapp.com",
  projectId: "work-report-volcani",
  storageBucket: "work-report-volcani.firebasestorage.app",
  messagingSenderId: "569559789764",
  appId: "1:569559789764:web:d11b9c0e43ff78a66dd991",
  measurementId: "G-M5Z4R1FB40",
  databaseURL: "https://work-report-volcani-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// DOM elements
const el = {
  authSection: document.getElementById('auth-section'),
  loading: document.getElementById('loading'),
  adminSection: document.getElementById('admin-section'),
  userSection: document.getElementById('user-section'),
  adminFilters: document.getElementById('admin-filters'),
  filterMonth: document.getElementById('filter-month'),
  filterYear: document.getElementById('filter-year'),
  allocateOthers: document.getElementById('allocate-others'),
  applyFilters: document.getElementById('apply-filters'),
  kpiHours: document.getElementById('kpi-hours'),
  kpiUsersCount: document.getElementById('kpi-users-count'),
  kpiEntriesCount: document.getElementById('kpi-entries-count'),
  usersTableBody: document.querySelector('#users-table tbody'),
  reportsTableBody: document.querySelector('#reports-table tbody'),
  selfUserTableBody: document.querySelector('#self-user-table tbody'),
  selfReportsTableBody: document.querySelector('#self-reports-table tbody'),
  btnSignIn: document.getElementById('signin-btn'),
  btnSignInMain: document.getElementById('signin-btn-main'),
  btnSignOut: document.getElementById('signout-btn'),
  btnExportAllCsv: document.getElementById('export-all-csv'),
  btnExportSelfCsv: document.getElementById('export-self-csv'),
  userInfo: document.getElementById('user-info'),
  barCanvas: document.getElementById('bar-hours-by-user'),
  pieCanvas: document.getElementById('pie-hours-by-category'),
};

let isAdmin = false;
let chartInstances = { bar: null, pie: null };
const HOURS_PER_DAY = 8;

function show(elm) { if (elm) elm.hidden = false; }
function hide(elm) { if (elm) elm.hidden = true; }

function setLoading(isLoading) {
  if (isLoading) { 
    show(el.loading); 
    updateLoadingProgress(0, 'מתחבר למערכת');
  } else { 
    hide(el.loading); 
  }
}

function updateLoadingProgress(percentage, message = null) {
  const progressBar = document.getElementById('admin-loading-progress-bar');
  const text = el.loading?.querySelector('.loading-text');
  
  if (progressBar) {
    progressBar.style.width = percentage + '%';
  }
  
  if (message && text) {
    text.innerHTML = message + '<span class="loading-dots"></span>';
  }
}

function setSignedOutUI() {
  hide(el.adminSection);
  hide(el.adminFilters);
  show(el.authSection);
  el.userInfo.textContent = '';
}

function setSignedInUI(user) {
  hide(el.authSection);
  el.userInfo.textContent = user?.email || '';
}

async function signIn() {
  // Redirect to homepage.html where the email/password login exists
  window.location.href = '/homepage.html';
}

async function signOut() {
  await firebaseSignOut(auth);
}

el.btnSignIn?.addEventListener('click', signIn);
el.btnSignInMain?.addEventListener('click', signIn);
el.btnSignOut?.addEventListener('click', signOut);

// Data caches for rendering and CSV export
const state = {
  usersById: {}, // { uid: user }
  reportsByUser: {}, // { uid: [report, ...] }
  selfReports: [],
  filters: {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    allocateOthers: true,
  },
};

async function attemptAdminDetection() {
  // Try several admin-only paths. If any succeed, treat as admin.
  const candidates = ['users', 'reports', 'adminOnly/ping'];
  for (const path of candidates) {
    try {
      const snapshot = await get(ref(db, path));
      console.info('[admin-check] allowed on path:', path, 'exists:', snapshot?.exists?.());
      return true;
    } catch (e) {
      console.warn('[admin-check] denied on path:', path, e?.code || e);
    }
  }
  return false;
}

function subscribeAsAdmin() {
  // Subscribe to all users
  onValue(ref(db, 'users'), snapshot => {
    const users = snapshot.val() || {};
    state.usersById = users;
    renderUsersTable(users);
    // Update charts if we already have reports
    renderAllAdminViews();
  });

  // Subscribe to all reports
  onValue(ref(db, 'reports'), snapshot => {
    const reports = snapshot.val() || {};
    state.reportsByUser = reports;
    renderAdminReportsTable(reports, state.usersById);
    renderAllAdminViews();
  });
}

function subscribeAsUser(uid) {
  // Own user doc
  onValue(ref(db, `users/${uid}`), snapshot => {
    const user = snapshot.val() || {};
    renderSelfUserTable(user);
  });

  // Own reports
  onValue(ref(db, `reports/${uid}`), snapshot => {
    const byId = snapshot.val() || {};
    const flat = [];
    Object.entries(byId).forEach(([reportId, r]) => {
      const date = r?.date || '';
      const type = r?.type || 'daily';
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      entries.forEach((e, idx) => {
        const hours = type === 'weekly' ? (Number(e?.days || 0) || 0) * HOURS_PER_DAY : (Number(e?.hours || 0) || 0);
        flat.push({ id: `${reportId}#${idx}`, uid, date, researcher: e?.researcher || '', hours, description: e?.detail || '' });
      });
    });
    flat.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    state.selfReports = flat;
    renderSelfReportsTable(flat);
  });
}

function formatDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('he-IL');
    }
    return String(value);
  } catch {
    return String(value);
  }
}

function renderUsersTable(users) {
  const rows = Object.entries(users).map(([uid, u]) => {
    const createdAt = u?.createdAt ? formatDate(u.createdAt) : '';
    return `<tr>
      <td>${escapeHtml(u?.firstName)}</td>
      <td>${escapeHtml(u?.lastName)}</td>
      <td>${escapeHtml(u?.position)}</td>
      <td>${escapeHtml(u?.email)}</td>
      <td>${escapeHtml(createdAt)}</td>
    </tr>`;
  });
  el.usersTableBody.innerHTML = rows.join('');
}

function renderSelfUserTable(user) {
  const createdAt = user?.createdAt ? formatDate(user.createdAt) : '';
  el.selfUserTableBody.innerHTML = `<tr>
    <td>${escapeHtml(user?.firstName)}</td>
    <td>${escapeHtml(user?.lastName)}</td>
    <td>${escapeHtml(user?.position)}</td>
    <td>${escapeHtml(user?.email)}</td>
    <td>${escapeHtml(createdAt)}</td>
  </tr>`;
}

function renderAdminReportsTable(reportsByUser, usersById) {
  const { month, year } = state.filters;
  const rows = [];
  Object.entries(reportsByUser || {}).forEach(([uid, byId]) => {
    const user = usersById?.[uid] || {};
    if (!byId) return;
    Object.values(byId).forEach(r => {
      const d = r?.date ? new Date(r.date) : null;
      if (!d || (d.getMonth() + 1) !== month || d.getFullYear() !== year) return;
      const type = r?.type || 'daily';
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      entries.forEach(e => {
        const hours = type === 'weekly' ? (Number(e?.days || 0) || 0) * HOURS_PER_DAY : (Number(e?.hours || 0) || 0);
        rows.push(`<tr>
          <td>${escapeHtml(fullName(user))}</td>
          <td>${escapeHtml(formatDate(r?.date))}</td>
          <td>${escapeHtml(e?.researcher || '')}</td>
          <td>${escapeHtml(String(hours))}</td>
          <td>${escapeHtml(e?.detail || '')}</td>
        </tr>`);
      });
    });
  });
  rows.sort();
  el.reportsTableBody.innerHTML = rows.join('');
}

function renderSelfReportsTable(list) {
  const rows = list.map(r => `<tr>
    <td>${escapeHtml(formatDate(r?.date))}</td>
    <td>${escapeHtml(r?.researcher || '')}</td>
    <td>${escapeHtml(String(r?.hours ?? ''))}</td>
    <td>${escapeHtml(r?.description || '')}</td>
  </tr>`);
  el.selfReportsTableBody.innerHTML = rows.join('');
}

function fullName(u) {
  const first = u?.firstName || '';
  const last = u?.lastName || '';
  return `${first} ${last}`.trim();
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function aggregateForAdmin(reportsByUser, usersById, filters) {
  const month = filters?.month;
  const year = filters?.year;
  const allocate = !!filters?.allocateOthers;

  const totalsByResearcher = {}; // researcher/task -> hours
  const totalsByUser = {}; // uid -> sum hours
  let entriesCount = 0;
  const usersWithHours = new Set();

  Object.entries(reportsByUser || {}).forEach(([uid, byId]) => {
    if (!byId) return;
    Object.values(byId || {}).forEach(r => {
      const d = r?.date ? new Date(r.date) : null;
      if (!d || (d.getMonth() + 1) !== month || d.getFullYear() !== year) return;
      const type = r?.type || 'daily';
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      const active = Array.isArray(usersById?.[uid]?.activeResearchers) ? usersById[uid].activeResearchers : [];
      entries.forEach(e => {
        const hours = type === 'weekly' ? (Number(e?.days || 0) || 0) * HOURS_PER_DAY : (Number(e?.hours || 0) || 0);
        if (!hours) return;
        entriesCount += 1;
        totalsByUser[uid] = (totalsByUser[uid] || 0) + hours;
        usersWithHours.add(uid);
        const name = e?.researcher || 'לא ידוע';
        if (allocate && name === 'משימות אחרות') {
          if (active.length > 0) {
            const portion = hours / active.length;
            active.forEach(n => { totalsByResearcher[n] = (totalsByResearcher[n] || 0) + portion; });
          }
        } else {
          totalsByResearcher[name] = (totalsByResearcher[name] || 0) + hours;
        }
      });
    });
  });

  const usersLabels = Object.keys(totalsByUser).map(uid => fullName(usersById[uid]) || uid);
  const usersData = Object.keys(totalsByUser).map(uid => round2(totalsByUser[uid]));
  const catLabels = Object.keys(totalsByResearcher);
  const catData = catLabels.map(cat => round2(totalsByResearcher[cat]));
  const totalHours = usersData.reduce((a, b) => a + b, 0);

  return { usersLabels, usersData, catLabels, catData, totalHours, usersCount: usersWithHours.size, entriesCount };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function renderChartsAndMaybeTables() {
  if (!isAdmin) return;
  const agg = aggregateForAdmin(state.reportsByUser, state.usersById, state.filters);
  renderBar(agg.usersLabels, agg.usersData);
  renderPie(agg.catLabels, agg.catData);
  if (el.kpiHours) el.kpiHours.textContent = String(agg.totalHours || 0);
  if (el.kpiUsersCount) el.kpiUsersCount.textContent = String(agg.usersCount || 0);
  if (el.kpiEntriesCount) el.kpiEntriesCount.textContent = String(agg.entriesCount || 0);
}

function renderBar(labels, data) {
  if (!el.barCanvas) return;
  if (chartInstances.bar) { chartInstances.bar.destroy(); }
  chartInstances.bar = new Chart(el.barCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'סך שעות לכל חוקר',
        data,
        backgroundColor: 'rgba(91, 141, 239, 0.6)',
        borderColor: 'rgba(91, 141, 239, 1)',
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true },
        tooltip: { enabled: true }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'שעות' } },
        x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } }
      }
    }
  });
}

function renderPie(labels, data) {
  if (!el.pieCanvas) return;
  if (chartInstances.pie) { chartInstances.pie.destroy(); }
  const colors = labels.map((_, i) => `hsl(${(i * 47) % 360} 70% 55% / 0.85)`);
  chartInstances.pie = new Chart(el.pieCanvas.getContext('2d'), {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: { responsive: true }
  });
}

function buildAllReportsFlat(reportsByUser, usersById, filters) {
  const flat = [];
  const month = filters?.month;
  const year = filters?.year;
  const allocate = !!filters?.allocateOthers;
  Object.entries(reportsByUser || {}).forEach(([uid, byId]) => {
    const user = usersById?.[uid] || {};
    const active = Array.isArray(user?.activeResearchers) ? user.activeResearchers : [];
    Object.entries(byId || {}).forEach(([reportId, r]) => {
      const d = r?.date ? new Date(r.date) : null;
      if (!d || (d.getMonth() + 1) !== month || d.getFullYear() !== year) return;
      const type = r?.type || 'daily';
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      entries.forEach(e => {
        const baseHours = type === 'weekly' ? (Number(e?.days || 0) || 0) * HOURS_PER_DAY : (Number(e?.hours || 0) || 0);
        if (!baseHours) return;
        const researcherName = e?.researcher || '';
        if (allocate && researcherName === 'משימות אחרות' && active.length > 0) {
          const portion = baseHours / active.length;
          active.forEach(name => {
            flat.push({
              uid,
              userName: fullName(user),
              email: user?.email || '',
              date: r?.date || '',
              researcher: name,
              hours: round2(portion),
              description: e?.detail || ''
            });
          });
        } else {
          flat.push({
            uid,
            userName: fullName(user),
            email: user?.email || '',
            date: r?.date || '',
            researcher: researcherName,
            hours: round2(baseHours),
            description: e?.detail || ''
          });
        }
      });
    });
  });
  return flat;
}

function toCsv(rows, columns) {
  const escapeCsv = v => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  const header = columns.map(c => escapeCsv(c.header)).join(',');
  const lines = rows.map(row => columns.map(c => escapeCsv(row[c.key])).join(','));
  return [header, ...lines].join('\n');
}

function download(filename, content, type = 'text/csv;charset=utf-8') {
  // Prepend UTF-8 BOM to ensure Hebrew renders correctly in Excel
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

function buildResearcherTotals(reportsByUser, usersById, filters) {
  const month = filters?.month;
  const year = filters?.year;
  const allocate = !!filters?.allocateOthers;
  const totalsByResearcher = {};

  Object.entries(reportsByUser || {}).forEach(([uid, byId]) => {
    const user = usersById?.[uid] || {};
    const active = Array.isArray(user?.activeResearchers) ? user.activeResearchers : [];
    Object.values(byId || {}).forEach(r => {
      const d = r?.date ? new Date(r.date) : null;
      if (!d || (d.getMonth() + 1) !== month || d.getFullYear() !== year) return;
      const type = r?.type || 'daily';
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      entries.forEach(e => {
        const baseHours = type === 'weekly' ? (Number(e?.days || 0) || 0) * HOURS_PER_DAY : (Number(e?.hours || 0) || 0);
        if (!baseHours) return;
        const name = e?.researcher || 'לא ידוע';
        if (allocate && name === 'משימות אחרות' && active.length > 0) {
          const portion = baseHours / active.length;
          active.forEach(n => { totalsByResearcher[n] = (totalsByResearcher[n] || 0) + portion; });
        } else {
          totalsByResearcher[name] = (totalsByResearcher[name] || 0) + baseHours;
        }
      });
    });
  });

  const rows = Object.keys(totalsByResearcher).map(name => ({
    researcher: name,
    totalHours: round2(totalsByResearcher[name]),
    allocationApplied: allocate ? 'כן' : 'לא',
  }));
  // keep a stable order
  rows.sort((a, b) => a.researcher.localeCompare(b.researcher));
  return rows;
}

el.btnExportAllCsv?.addEventListener('click', () => {
  if (!isAdmin) return;
  
  // Show loading state
  setLoading(true);
  updateLoadingProgress(10, 'מכין נתונים לייצוא');
  
  // Read current UI state to honor checkbox even if filters weren't applied
  const allocateNow = !!el.allocateOthers?.checked;
  const month = Number(el.filterMonth?.value || state.filters.month);
  const year = Number(el.filterYear?.value || state.filters.year);
  const filters = { month, year, allocateOthers: allocateNow };

  updateLoadingProgress(30, 'מעבד נתונים מפורטים');
  // Detailed section (per user, date, researcher, hours, description)
  const detailedRows = buildAllReportsFlat(state.reportsByUser, state.usersById, filters);
  const detailedCsv = toCsv(detailedRows, [
    { key: 'uid', header: 'UID' },
    { key: 'userName', header: 'שם עובד' },
    { key: 'email', header: 'אימייל' },
    { key: 'date', header: 'תאריך' },
    { key: 'researcher', header: 'חוקר/משימה' },
    { key: 'hours', header: 'שעות' },
    { key: 'description', header: 'פרטים' },
  ]);

  updateLoadingProgress(60, 'מעבד סיכומים');
  // Separator and totals section
  const totals = buildResearcherTotals(state.reportsByUser, state.usersById, filters);
  const totalsCsv = toCsv(totals, [
    { key: 'researcher', header: 'חוקר/משימה' },
    { key: 'totalHours', header: 'סה"כ שעות (חודש נבחר)' },
    { key: 'allocationApplied', header: 'חלוקת "משימות אחרות"' },
  ]);

  updateLoadingProgress(80, 'יוצר קובץ');
  const combined = detailedCsv + '\n\n----- סיכום לפי חוקר -----\n' + totalsCsv;
  const suffix = allocateNow ? 'with_allocation' : 'no_allocation';
  
  updateLoadingProgress(100, 'מוריד קובץ');
  download(`reports_full_${suffix}_${new Date().toISOString().slice(0,10)}.csv`, combined, 'text/csv;charset=utf-8');
  
  // Hide loading after download
  setTimeout(() => {
    setLoading(false);
  }, 1000);
});

el.btnExportSelfCsv?.addEventListener('click', () => {
  const csv = toCsv(state.selfReports, [
    { key: 'date', header: 'תאריך' },
    { key: 'researcher', header: 'חוקר/משימה' },
    { key: 'hours', header: 'שעות' },
    { key: 'description', header: 'פרטים' },
  ]);
  download(`my_reports_${new Date().toISOString().slice(0,10)}.csv`, csv);
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    // Not signed-in: redirect to homepage to sign in
    window.location.href = '/homepage.html';
    return;
  }
  setSignedInUI(user);
  setLoading(true);
  
  updateLoadingProgress(20, 'בודק הרשאות מנהל');
  const allowed = await attemptAdminDetection();
  
  updateLoadingProgress(60, 'טוען נתונים');
  
  if (allowed) {
    // Admin view
    isAdmin = true;
    show(el.adminSection);
    show(el.adminFilters);
    initYearOptions();
    syncFiltersUI();
    
    updateLoadingProgress(80, 'מעבד נתונים');
    renderAllAdminViews();
    subscribeAsAdmin();
    
    updateLoadingProgress(100, 'מסיים טעינה');
    
    // Hide loading after a short delay
    setTimeout(() => {
      setLoading(false);
      if (location.hash !== '#/admin') {
        location.hash = '#/admin';
      }
    }, 500);
  } else {
    // Non-admin shouldn't be here – send to homepage
    isAdmin = false;
    updateLoadingProgress(100, 'מסיים טעינה');
    setTimeout(() => {
      setLoading(false);
      window.location.href = '/homepage.html';
    }, 500);
  }
});

function applyRoute() {
  const hash = location.hash;
  if (hash === '#/admin' && isAdmin) {
    show(el.adminSection);
  }
}

window.addEventListener('hashchange', applyRoute);

function initYearOptions() {
  if (!el.filterYear) return;
  const now = new Date().getFullYear();
  el.filterYear.innerHTML = '';
  for (let y = now - 2; y <= now + 1; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === state.filters.year) opt.selected = true;
    el.filterYear.appendChild(opt);
  }
}

function syncFiltersUI() {
  if (el.filterMonth) el.filterMonth.value = String(state.filters.month);
  if (el.filterYear) el.filterYear.value = String(state.filters.year);
  if (el.allocateOthers) el.allocateOthers.checked = !!state.filters.allocateOthers;
}

el.applyFilters?.addEventListener('click', () => {
  if (!isAdmin) return;
  
  // Show loading state
  setLoading(true);
  updateLoadingProgress(20, 'מעבד סינון');
  
  const month = Number(el.filterMonth?.value || state.filters.month);
  const year = Number(el.filterYear?.value || state.filters.year);
  const allocate = !!el.allocateOthers?.checked;
  state.filters = { month, year, allocateOthers: allocate };
  
  updateLoadingProgress(60, 'מעדכן טבלאות');
  renderAdminReportsTable(state.reportsByUser, state.usersById);
  
  updateLoadingProgress(80, 'מעדכן גרפים');
  renderChartsAndMaybeTables();
  
  updateLoadingProgress(100, 'מסיים רענון');
  
  // Hide loading after a short delay
  setTimeout(() => {
    setLoading(false);
  }, 500);
});

function renderAllAdminViews() {
  renderAdminReportsTable(state.reportsByUser, state.usersById);
  renderChartsAndMaybeTables();
}
