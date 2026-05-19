// js/my-bi.js  –  לוח BI אישי למשתמש הרגיל
// ==============================================================
// 2 קריאות Firestore קבועות (ניסויים שלי + רשימת שיתופים),
// + קריאות מקבילות לניסויים המשותפים (Promise.all).
// כל ניתוח הנתונים – בצד הלקוח בלבד.
// ==============================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from "./toast.js";

let currentUser = null;
let userData    = null;
/** @type {Array<{id:string, ownerUid:string, isShared:boolean, [key:string]:any}>} */
let allExperiments = [];

// ======================================================
// Bootstrap
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    initSidebarListeners();
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
});

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    currentUser = user;

    const approved = await checkApproval();
    if (!approved) return;

    await loadUserInfo();
    await loadAndRender();
});

// ======================================================
// Approval check
// ======================================================
async function checkApproval() {
    try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid));
        if (snap.exists() && snap.data().isApproved === true) return true;
        await signOut(auth);
        window.location.href = 'login.html';
        return false;
    } catch {
        window.location.href = 'login.html';
        return false;
    }
}

// ======================================================
// Sidebar
// ======================================================
function initSidebarListeners() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar      = document.querySelector('.sidebar');
    const overlay      = document.getElementById('sidebar-overlay');

    if (hamburgerBtn && sidebar) {
        hamburgerBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
            const icon = hamburgerBtn.querySelector('i');
            if (icon) { icon.classList.toggle('fa-bars'); icon.classList.toggle('fa-times'); }
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
            const icon = hamburgerBtn?.querySelector('i');
            if (icon) { icon.classList.add('fa-bars'); icon.classList.remove('fa-times'); }
        });
    }
}

// ======================================================
// Load user info + optional admin menu
// ======================================================
async function loadUserInfo() {
    const nameEl = document.getElementById('user-display-name');
    try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid));
        if (snap.exists()) {
            userData = snap.data();
            if (nameEl) {
                nameEl.textContent = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || currentUser.email;
            }
            await checkAndDisplayAdminMenu();
        }
    } catch (e) {
        console.error('loadUserInfo:', e);
    }
}

async function checkAndDisplayAdminMenu() {
    try {
        const q    = query(collection(db, 'users'), limit(2));
        const snap = await getDocs(q);
        if (snap.size > 1) displayAdminMenu();
    } catch {
        // no admin rights – fine
    }
}

function displayAdminMenu() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav || nav.querySelector('.admin-menu-section')) return;
    nav.insertAdjacentHTML('beforeend', `
        <div class="admin-menu-section">
            <div class="nav-separator"></div>
            <div class="nav-section-title">ניהול מערכת</div>
            <a href="admin-users.html" class="nav-item">
                <i class="fas fa-users-cog"></i>
                <span>ניהול משתמשים</span>
            </a>
            <a href="admin-experiments.html" class="nav-item">
                <i class="fas fa-flask"></i>
                <span>כל הניסויים</span>
            </a>
            <a href="bi.html" class="nav-item">
                <i class="fas fa-chart-bar"></i>
                <span>לוח BI</span>
            </a>
        </div>
    `);
}

// ======================================================
// Main: load experiments → analyse → render
// ======================================================
async function loadAndRender() {
    const loadingEl = document.getElementById('loading-container');
    const contentEl = document.getElementById('bi-content');

    try {
        // --- קריאה 1: ניסויים שלי ---
        const myRef  = collection(db, 'users', currentUser.uid, 'experiments');
        const mySnap = await getDocs(query(myRef, orderBy('createdAt', 'desc')));

        const myExperiments = mySnap.docs.map(d => ({
            id: d.id,
            ownerUid: currentUser.uid,
            isShared: false,
            ...d.data()
        }));

        // --- קריאה 2: רשימת ניסויים משותפים ---
        const sharedRef  = collection(db, 'users', currentUser.uid, 'sharedExperiments');
        const sharedSnap = await getDocs(sharedRef);

        // --- קריאות מקבילות לניסויים המשותפים ---
        const sharedFetches = sharedSnap.docs.map(async sharedDoc => {
            const sharedData = sharedDoc.data();
            const { ownerUid, experimentId, cachedExperiment } = sharedData;
            if (!ownerUid || !experimentId) return null;

            if (cachedExperiment && typeof cachedExperiment === 'object') {
                return {
                    id: experimentId,
                    ownerUid,
                    isShared: true,
                    ...cachedExperiment
                };
            }

            try {
                const expSnap = await getDoc(doc(db, 'users', ownerUid, 'experiments', experimentId));
                if (!expSnap.exists()) return null;
                return { id: experimentId, ownerUid, isShared: true, ...expSnap.data() };
            } catch {
                return null;
            }
        });

        const sharedResults = (await Promise.all(sharedFetches)).filter(Boolean);

        allExperiments = [...myExperiments, ...sharedResults];

        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.classList.remove('hidden');

        // --- Render after content is visible (Leaflet needs visible container) ---
        renderAll(myExperiments.length, sharedResults.length);

    } catch (err) {
        console.error('loadAndRender:', err);
        showToast('שגיאה בטעינת הנתונים', 'error');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// ======================================================
// Render orchestrator
// ======================================================
function renderAll(ownCount, sharedCount) {
    const exps = allExperiments;

    // ownership badges
    setText('own-count',    ownCount);
    setText('shared-count', sharedCount);

    // KPIs
    setText('kpi-total',    exps.length);
    setText('kpi-sites',    countUnique(exps, e => norm(e.experimentSite)));
    setText('kpi-varieties',countUnique(exps, e => norm(cropField(e, 'variety'))));
    setText('kpi-keywords', countUniqueFlat(exps, e => Array.isArray(e.keywords) ? e.keywords : []));
    setText('kpi-packages', countUnique(exps, e => norm(e.workPackage)));

    // Charts (client-side only)
    renderChartByYear(exps);
    renderChartBySite(exps);
    renderChartByPackage(exps);
    renderChartByCrop(exps);

    // Map
    renderExperimentsMap(exps);

    // Keywords
    renderKeywordsCloud(exps);

    // Table
    renderExperimentsTable(exps);

    // Timestamp
    const label = document.getElementById('last-updated-label');
    if (label) label.textContent = `עודכן: ${new Date().toLocaleString('he-IL')}`;
}

// ======================================================
// Render Map – from experiments siteCoordinates
// ======================================================
function renderExperimentsMap(exps) {
    const mapContainer = document.getElementById('experiments-map');
    if (!mapContainer) return;

    mapContainer.innerHTML = '';

    // Parse coordinates from already-loaded experiment docs (no extra Firestore reads)
    const expsWithCoords = exps
        .map(exp => {
            const coordinates = parseExperimentCoordinates(exp);
            return coordinates ? { exp, ...coordinates } : null;
        })
        .filter(Boolean);

    if (expsWithCoords.length === 0) {
        mapContainer.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:16px;text-align:center;padding:20px;direction:rtl;">
                <div>
                    <div style="font-size:32px;margin-bottom:8px;">📍</div>
                    <strong>לא היתה אפשרות להציג את המפה</strong>
                    <div style="font-size:13px;margin-top:8px;color:#d1d5db;">אין קואורדינטות בניסויים</div>
                </div>
            </div>
        `;
        return;
    }

    // Initialize map centered on Israel
    const map = L.map(mapContainer).setView([31.5, 34.75], 7);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Add marker for each experiment
    const markers = [];
    expsWithCoords.forEach(({ exp, lat, lng }) => {
        const color = exp.isShared ? '#3b82f6' : '#16a34a';

        const marker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'experiment-marker',
                html: `<div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);"><i class="fas fa-flask" style="color:#fff;font-size:13px;"></i></div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -14]
            })
        }).addTo(map);

        // Popup with experiment name and site
        const expName = escHtml(norm(exp.experimentName) || 'ללא שם');
        const siteName = escHtml(norm(exp.experimentSite) || 'לא צוין');
        
        marker.bindPopup(`
            <div style="font-family: 'Heebo', sans-serif; text-align: right; direction: rtl; min-width: 180px;">
                <strong style="font-size: 13px; color: #1a1a1a; display: block; margin-bottom: 4px;">🧪 ${expName}</strong>
                <span style="font-size: 12px; color: #6b7280;">📍 אתר: ${siteName}</span><br/>
                <span style="font-size: 11px; color: #9ca3af;">קואורדינטות: ${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
            </div>
        `);

        markers.push(marker);
    });

    addMapScaleControl(map);
    addMapHelpControl(map, {
        title: 'הוראות מהירות',
        lines: [
            'לחיצה על סמן פותחת פרטי ניסוי',
            'ניתן להתקרב/להתרחק עם גלגלת העכבר',
            'כפתור 🎯 מחזיר תצוגה לכל הניסויים'
        ]
    });

    const ownCount = expsWithCoords.filter(x => !x.exp.isShared).length;
    const sharedCount = expsWithCoords.filter(x => x.exp.isShared).length;
    addMapLegendControl(map, {
        total: expsWithCoords.length,
        own: ownCount,
        shared: sharedCount,
        showOwnership: true
    });

    // Auto-fit map to show all markers
    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        const bounds = group.getBounds().pad(0.1);
        map.fitBounds(bounds);
        addMapResetViewControl(map, bounds);
    }
}

function addMapScaleControl(map) {
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
}

function addMapHelpControl(map, config) {
    const control = L.control({ position: 'topleft' });
    control.onAdd = () => {
        const div = L.DomUtil.create('div');
        div.style.background = '#fff';
        div.style.padding = '10px 12px';
        div.style.borderRadius = '10px';
        div.style.boxShadow = '0 1px 6px rgba(0,0,0,.2)';
        div.style.minWidth = '220px';
        div.style.direction = 'rtl';
        div.style.fontFamily = 'Heebo, sans-serif';
        div.innerHTML = `
            <div style="font-weight:700;font-size:13px;color:#1f2937;margin-bottom:6px;">💡 ${escHtml(config.title)}</div>
            <ul style="margin:0;padding:0 16px 0 0;color:#4b5563;font-size:12px;line-height:1.45;">
                ${config.lines.map(line => `<li style="margin-bottom:2px;">${escHtml(line)}</li>`).join('')}
            </ul>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
    };
    control.addTo(map);
}

function addMapLegendControl(map, stats) {
    const control = L.control({ position: 'topright' });
    control.onAdd = () => {
        const div = L.DomUtil.create('div');
        div.style.background = '#fff';
        div.style.padding = '10px 12px';
        div.style.borderRadius = '10px';
        div.style.boxShadow = '0 1px 6px rgba(0,0,0,.2)';
        div.style.minWidth = '180px';
        div.style.direction = 'rtl';
        div.style.fontFamily = 'Heebo, sans-serif';

        const ownershipRows = stats.showOwnership ? `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;font-size:12px;color:#1f2937;">
                <span>🟦 שותף/ה</span><strong>${stats.shared}</strong>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;font-size:12px;color:#1f2937;">
                <span>🟩 שלי</span><strong>${stats.own}</strong>
            </div>
        ` : '';

        div.innerHTML = `
            <div style="font-weight:700;font-size:13px;color:#1f2937;margin-bottom:6px;">🧪 מקרא</div>
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#1f2937;">
                <span style="width:22px;height:22px;border-radius:50%;background:#3b82f6;color:#fff;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.2);font-size:11px;">⚗</span>
                <span>מיקום ניסוי</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:12px;color:#1f2937;">
                <span>סה"כ על המפה</span><strong>${stats.total}</strong>
            </div>
            ${ownershipRows}
        `;

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
    };
    control.addTo(map);
}

function addMapResetViewControl(map, bounds) {
    const control = L.control({ position: 'bottomright' });
    control.onAdd = () => {
        const button = L.DomUtil.create('button');
        button.type = 'button';
        button.title = 'מיקוד לכל הניסויים';
        button.style.width = '38px';
        button.style.height = '38px';
        button.style.border = 'none';
        button.style.borderRadius = '10px';
        button.style.cursor = 'pointer';
        button.style.background = '#2563eb';
        button.style.color = '#fff';
        button.style.fontSize = '18px';
        button.style.boxShadow = '0 1px 6px rgba(0,0,0,.25)';
        button.textContent = '🎯';
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.on(button, 'click', () => map.fitBounds(bounds));
        return button;
    };
    control.addTo(map);
}

function parseExperimentCoordinates(exp) {
    const direct = parseCoordinatesValue(exp?.siteCoordinates);
    if (direct) return direct;

    const nested = parseCoordinatesValue(exp?.locationCoordinates);
    if (nested) return nested;

    return null;
}

function parseCoordinatesValue(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        const cleaned = value.replace(/[()\[\]]/g, '').replace(';', ',');
        const parts = cleaned.split(',').map(p => parseFloat(p.trim()));
        if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
        return validateLatLng(parts[0], parts[1]);
    }

    if (typeof value === 'object') {
        const rawLat = value.lat ?? value.latitude;
        const rawLng = value.lng ?? value.lon ?? value.longitude;
        const lat = Number(rawLat);
        const lng = Number(rawLng);
        if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
        return validateLatLng(lat, lng);
    }

    return null;
}

function validateLatLng(lat, lng) {
    if (lat < -90 || lat > 90) return null;
    if (lng < -180 || lng > 180) return null;
    return { lat, lng };
}
function renderChartByYear(exps) {
    const freq   = freqMap(exps, e => e.experimentYear ? String(e.experimentYear) : 'לא צוין');
    const sorted = Object.entries(freq).sort((a, b) => a[0].localeCompare(b[0]));
    drawBarChart('chart-by-year', sorted.map(x => x[0]), sorted.map(x => x[1]), '#3b82f6');
}

function renderChartBySite(exps) {
    const freq   = freqMap(exps, e => norm(e.experimentSite) || 'לא צוין');
    const sorted = sortedEntries(freq, 8);
    drawHBarChart('chart-by-site', sorted.map(x => x[0]), sorted.map(x => x[1]), '#d97706');
}

function renderChartByPackage(exps) {
    const freq   = freqMap(exps, e => norm(e.workPackage) || 'לא צוין');
    const sorted = sortedEntries(freq, 8);
    drawDoughnutChart('chart-by-package', sorted.map(x => x[0]), sorted.map(x => x[1]));
}

function renderChartByCrop(exps) {
    const freq   = freqMap(exps, e => norm(cropField(e, 'cropType')) || 'לא צוין');
    const sorted = sortedEntries(freq, 8);
    drawHBarChart('chart-by-crop', sorted.map(x => x[0]), sorted.map(x => x[1]), '#16a34a');
}

// ======================================================
// Keywords Cloud
// ======================================================
function renderKeywordsCloud(exps) {
    const freq = {};
    exps.forEach(e => {
        (Array.isArray(e.keywords) ? e.keywords : []).forEach(k => {
            const key = norm(k);
            if (key) freq[key] = (freq[key] || 0) + 1;
        });
    });

    const container = document.getElementById('keywords-cloud');
    if (!container) return;

    if (!Object.keys(freq).length) {
        container.innerHTML = '<span class="no-data">אין מילות מפתח עדיין</span>';
        return;
    }

    const max     = Math.max(...Object.values(freq));
    const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);

    container.innerHTML = entries.map(([word, count]) => {
        const cls = getSizeClass(count, max);
        return `<span class="kw-tag ${cls}" title="${count} ניסויים">${escHtml(word)}</span>`;
    }).join('');
}

function getSizeClass(count, max) {
    const r = count / max;
    if (r > 0.8) return 'size-5';
    if (r > 0.6) return 'size-4';
    if (r > 0.4) return 'size-3';
    if (r > 0.2) return 'size-2';
    return '';
}

// ======================================================
// Experiments Table
// ======================================================
function renderExperimentsTable(exps) {
    const tbody = document.getElementById('experiments-table-body');
    if (!tbody) return;

    if (!exps.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">אין ניסויים להצגה</td></tr>';
        return;
    }

    const sorted = [...exps].sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const db_ = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return db_ - da;
    });

    tbody.innerHTML = sorted.map(e => {
        const href = e.isShared
            ? `experiment.html?id=${e.id}&owner=${e.ownerUid}`
            : `experiment.html?id=${e.id}`;
        const badge = e.isShared
            ? '<span class="tag-shared">שותף/ה</span>'
            : '<span class="tag-own">שלי</span>';
        return `
          <tr>
            <td><a class="exp-link" href="${href}">${escHtml(e.experimentName || 'ללא שם')}</a></td>
            <td>${e.experimentYear || '-'}</td>
            <td>${escHtml(norm(e.experimentSite) || '-')}</td>
            <td>${escHtml(norm(e.workPackage) || '-')}</td>
            <td>${badge}</td>
          </tr>`;
    }).join('');
}

// ======================================================
// Chart Factory Helpers
// ======================================================
const PALETTE = [
    '#4f46e5','#0ea5e9','#16a34a','#d97706','#e11d48',
    '#7c3aed','#0891b2','#65a30d','#f59e0b','#ef4444',
    '#8b5cf6','#06b6d4','#84cc16','#f97316','#ec4899'
];

function drawBarChart(canvasId, labels, data, color) {
    const ctx = getCtx(canvasId);
    if (!ctx) return;
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data, backgroundColor: color, borderRadius: 6, maxBarThickness: 40 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { font: { family: 'Heebo' }, color: '#374151' } },
                y: { beginAtZero: true, ticks: { font: { family: 'Heebo' }, precision: 0 } }
            }
        }
    });
}

function drawHBarChart(canvasId, labels, data, color) {
    const ctx = getCtx(canvasId);
    if (!ctx) return;
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data, backgroundColor: color, borderRadius: 4, maxBarThickness: 26 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { font: { family: 'Heebo' }, precision: 0 } },
                y: { ticks: { font: { family: 'Heebo' }, color: '#374151' } }
            }
        }
    });
}

function drawDoughnutChart(canvasId, labels, data) {
    const ctx = getCtx(canvasId);
    if (!ctx) return;
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: PALETTE.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { font: { family: 'Heebo', size: 12 }, padding: 10, boxWidth: 14 }
                }
            }
        }
    });
}

// ======================================================
// Data Helpers
// ======================================================
function cropField(exp, field) {
    return exp?.cropDetails?.data?.[field] ?? exp?.[field] ?? '';
}

function norm(val) { return (val || '').trim() || null; }

function freqMap(exps, keyFn) {
    const map = {};
    exps.forEach(e => {
        const k = keyFn(e);
        if (k != null) map[k] = (map[k] || 0) + 1;
    });
    return map;
}

function sortedEntries(freq, topN = 10) {
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, topN);
}

function countUnique(exps, keyFn) {
    return new Set(exps.map(keyFn).filter(Boolean)).size;
}

function countUniqueFlat(exps, listFn) {
    const set = new Set();
    exps.forEach(e => listFn(e).forEach(k => { const n = norm(k); if (n) set.add(n); }));
    return set.size;
}

// ======================================================
// DOM Helpers
// ======================================================
function getCtx(id) {
    const el = document.getElementById(id);
    return el ? el.getContext('2d') : null;
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ======================================================
// Logout
// ======================================================
async function handleLogout() {
    try { await signOut(auth); window.location.href = 'login.html'; }
    catch (e) { console.error(e); }
}
