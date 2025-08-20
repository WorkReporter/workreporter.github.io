// Firebase Admin Dashboard (client-only, secured by Realtime Database Security Rules)
// Assumptions:
// - Realtime Database structure:
//   users/{uid} => { firstName, lastName, position, email, createdAt }
//   reports/{uid}/{reportId} => { date: ISO string or yyyy-mm-dd, category: string, hours: number, description?: string }
// - Admin detection is done by attempting to read the protected path 'users' root.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, get, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// TODO: Paste your Firebase config here. Do NOT include any admin email in client code.
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_AUTH_DOMAIN',
  databaseURL: 'YOUR_DATABASE_URL',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID'
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

function show(elm) { if (elm) elm.hidden = false; }
function hide(elm) { if (elm) elm.hidden = true; }

function setLoading(isLoading) {
  if (isLoading) { show(el.loading); } else { hide(el.loading); }
}

function setSignedOutUI() {
  hide(el.adminSection);
  hide(el.userSection);
  show(el.authSection);
  el.userInfo.textContent = '';
}

function setSignedInUI(user) {
  hide(el.authSection);
  el.userInfo.textContent = user?.email || '';
}

async function signIn() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
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
};

function attemptAdminDetection() {
  // We attempt to read the protected root 'users'. Only the manager can read it per Security Rules.
  return get(ref(db, 'users'))
    .then(snapshot => {
      isAdmin = true;
      return snapshot;
    })
    .catch(err => {
      isAdmin = false;
      return null;
    });
}

function subscribeAsAdmin() {
  // Subscribe to all users
  onValue(ref(db, 'users'), snapshot => {
    const users = snapshot.val() || {};
    state.usersById = users;
    renderUsersTable(users);
    // Update charts if we already have reports
    renderChartsAndMaybeTables();
  });

  // Subscribe to all reports
  onValue(ref(db, 'reports'), snapshot => {
    const reports = snapshot.val() || {};
    state.reportsByUser = reports;
    renderAdminReportsTable(reports, state.usersById);
    renderChartsAndMaybeTables();
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
    const reports = snapshot.val() || {};
    const list = Object.entries(reports).map(([id, r]) => ({ id, uid, ...r }));
    state.selfReports = list;
    renderSelfReportsTable(list);
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
  const rows = [];
  Object.entries(reportsByUser).forEach(([uid, items]) => {
    const user = usersById?.[uid] || {};
    if (!items) return;
    Object.entries(items).forEach(([reportId, r]) => {
      rows.push(`<tr>
        <td>${escapeHtml(fullName(user))}</td>
        <td>${escapeHtml(uid)}</td>
        <td>${escapeHtml(formatDate(r?.date))}</td>
        <td>${escapeHtml(r?.category)}</td>
        <td>${escapeHtml(String(r?.hours ?? ''))}</td>
        <td>${escapeHtml(r?.description || '')}</td>
      </tr>`);
    });
  });
  rows.sort();
  el.reportsTableBody.innerHTML = rows.join('');
}

function renderSelfReportsTable(list) {
  const rows = list.map(r => `<tr>
    <td>${escapeHtml(formatDate(r?.date))}</td>
    <td>${escapeHtml(r?.category)}</td>
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

function aggregateForAdmin(reportsByUser, usersById) {
  const totalsByUser = {}; // uid -> sum hours
  const totalsByCategory = {}; // category -> sum hours

  Object.entries(reportsByUser || {}).forEach(([uid, items]) => {
    Object.values(items || {}).forEach(r => {
      const hours = Number(r?.hours || 0) || 0;
      totalsByUser[uid] = (totalsByUser[uid] || 0) + hours;
      const cat = r?.category || 'אחר';
      totalsByCategory[cat] = (totalsByCategory[cat] || 0) + hours;
    });
  });

  const usersLabels = Object.keys(totalsByUser).map(uid => fullName(usersById[uid]) || uid);
  const usersData = Object.keys(totalsByUser).map(uid => round2(totalsByUser[uid]));

  const catLabels = Object.keys(totalsByCategory);
  const catData = catLabels.map(cat => round2(totalsByCategory[cat]));

  return { usersLabels, usersData, catLabels, catData };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function renderChartsAndMaybeTables() {
  if (!isAdmin) return;
  const { usersLabels, usersData, catLabels, catData } = aggregateForAdmin(state.reportsByUser, state.usersById);
  renderBar(usersLabels, usersData);
  renderPie(catLabels, catData);
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

function buildAllReportsFlat(reportsByUser, usersById) {
  const flat = [];
  Object.entries(reportsByUser || {}).forEach(([uid, items]) => {
    const user = usersById?.[uid] || {};
    Object.entries(items || {}).forEach(([reportId, r]) => {
      flat.push({
        uid,
        userName: fullName(user),
        email: user?.email || '',
        date: r?.date || '',
        category: r?.category || '',
        hours: Number(r?.hours || 0) || 0,
        description: r?.description || ''
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
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

el.btnExportAllCsv?.addEventListener('click', () => {
  if (!isAdmin) return;
  const rows = buildAllReportsFlat(state.reportsByUser, state.usersById);
  const csv = toCsv(rows, [
    { key: 'uid', header: 'UID' },
    { key: 'userName', header: 'שם עובד' },
    { key: 'email', header: 'אימייל' },
    { key: 'date', header: 'תאריך' },
    { key: 'category', header: 'קטגוריה' },
    { key: 'hours', header: 'שעות' },
    { key: 'description', header: 'תיאור' },
  ]);
  download(`reports_all_${new Date().toISOString().slice(0,10)}.csv`, csv);
});

el.btnExportSelfCsv?.addEventListener('click', () => {
  const csv = toCsv(state.selfReports, [
    { key: 'date', header: 'תאריך' },
    { key: 'category', header: 'קטגוריה' },
    { key: 'hours', header: 'שעות' },
    { key: 'description', header: 'תיאור' },
  ]);
  download(`my_reports_${new Date().toISOString().slice(0,10)}.csv`, csv);
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    setSignedOutUI();
    return;
  }
  setSignedInUI(user);
  setLoading(true);
  const snapshot = await attemptAdminDetection();
  setLoading(false);
  if (snapshot) {
    // Admin view
    isAdmin = true;
    show(el.adminSection);
    hide(el.userSection);
    subscribeAsAdmin();
  } else {
    // Regular user view
    isAdmin = false;
    hide(el.adminSection);
    show(el.userSection);
    subscribeAsUser(user.uid);
  }
});

