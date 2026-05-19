// js/export.js
// Client-side experiment export — Excel (SheetJS) and ZIP (JSZip + FileSaver)
import { formatDateIL } from "./date-utils.js";
import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    doc, getDoc, collection, collectionGroup, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    ref, listAll, getBlob
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { showToast } from "./toast.js";
import { initServerTime, getTrustedNow } from "./server-time.js";
import { canRead } from "./permissions-utils.js";

let currentUser = null;
let userData = null;
let isAdmin = false;

// ── DOM Ready ──
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
});

function initSidebar() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');

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
        });
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => { await signOut(auth); window.location.href = "login.html"; });
}

// ── Auth ──
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    currentUser = user;

    const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (!userDocSnap.exists() || !userDocSnap.data().isApproved) { await signOut(auth); window.location.href = "login.html"; return; }
    userData = userDocSnap.data();

    const displayName = document.getElementById('user-display-name');
    if (displayName) displayName.textContent = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || currentUser.email;

    // אתחול זמן שרת
    await initServerTime(db, currentUser);

    await checkAndDisplayAdminMenu();
    await loadExperimentsForExport();
});

// ── Admin menu (same logic as dashboard.js) ──
async function checkAndDisplayAdminMenu() {
    try {
        const usersQuery = query(collection(db, "users"), limit(2));
        const snapshot = await getDocs(usersQuery);
        if (snapshot.size > 1) {
            isAdmin = true;
            const sidebar = document.querySelector('.sidebar-nav');
            if (!sidebar) return;
            sidebar.insertAdjacentHTML('beforeend', `
                <div class="nav-separator"></div>
                <div class="nav-section-title">ניהול מערכת</div>
                <a href="admin-users.html" class="nav-item"><i class="fas fa-users-cog"></i><span>ניהול משתמשים</span></a>
                <a href="admin-experiments.html" class="nav-item"><i class="fas fa-flask"></i><span>כל הניסויים</span></a>
            `);
        }
    } catch (_) { /* no admin */ }
}

// ══════════════════════════════════════════
// Load experiments
// ══════════════════════════════════════════
async function loadExperimentsForExport() {
    const grid = document.getElementById('export-grid');
    const loading = document.getElementById('loading-container');
    if (!grid) return;

    const experiments = [];

    try {
        if (isAdmin) {
            // ── אדמין: טען את כל הניסויים במערכת דרך collectionGroup ──
            const allQuery = query(collectionGroup(db, 'experiments'));
            const allSnap = await getDocs(allQuery);

            allSnap.forEach(docSnap => {
                const data = docSnap.data();
                // חילוץ ownerUid מה-path: users/{ownerUid}/experiments/{id}
                const pathParts = docSnap.ref.path.split('/');
                const ownerUid = pathParts[1];
                const isOwn = ownerUid === currentUser.uid;

                // סינון פרטיים שפג תוקפם - רק אם המשתמש הוא לא הבעלים
                let isPrivate = false;
                if (data.visibility === 'private' && data.privateUntil) {
                    let untilDate;
                    if (typeof data.privateUntil.toDate === 'function') {
                        untilDate = data.privateUntil.toDate();
                    } else if (data.privateUntil.seconds) {
                        untilDate = new Date(data.privateUntil.seconds * 1000);
                    } else {
                        untilDate = new Date(data.privateUntil);
                    }
                    if (untilDate > getTrustedNow()) isPrivate = true;
                }

                // דלג על ניסויים פרטיים (אלא אם אתה הבעלים)
                if (isPrivate && !isOwn) return;

                experiments.push({
                    id: docSnap.id,
                    ownerUid: ownerUid,
                    data: data,
                    shared: !isOwn
                });
            });
        } else {
            // ── משתמש רגיל: הניסויים שלי + משותפים ──
            const myRef = collection(db, "users", currentUser.uid, "experiments");
            const mySnap = await getDocs(query(myRef, orderBy("createdAt", "desc")));
            mySnap.forEach(d => experiments.push({ id: d.id, ownerUid: currentUser.uid, data: d.data(), shared: false }));

            const sharedRef = collection(db, "users", currentUser.uid, "sharedExperiments");
            const sharedSnap = await getDocs(sharedRef);
            for (const sd of sharedSnap.docs) {
                const s = sd.data();
                if (s.ownerUid && s.experimentId) {
                    try {
                        const origSnap = await getDoc(doc(db, "users", s.ownerUid, "experiments", s.experimentId));
                        if (origSnap.exists()) experiments.push({ id: s.experimentId, ownerUid: s.ownerUid, data: origSnap.data(), shared: true });
                    } catch (_) {}
                }
            }
        }
    } catch (err) {
        console.error("Error loading experiments:", err);
        showToast('שגיאה בטעינת הניסויים', 'error');
    }

    if (loading) loading.classList.add('hidden');
    grid.style.display = 'flex';

    if (experiments.length === 0) {
        grid.innerHTML = '<div class="export-empty"><i class="fas fa-flask"></i><p>אין ניסויים להצגה</p></div>';
        return;
    }

    // מיון לפי תאריך יצירה (חדשים קודם)
    experiments.sort((a, b) => {
        const dateA = a.data.createdAt?.toDate?.() || new Date(0);
        const dateB = b.data.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
    });

    experiments.forEach(exp => grid.appendChild(createExportCard(exp)));
}

// ══════════════════════════════════════════
// Create export card
// ══════════════════════════════════════════
function createExportCard(exp) {
    const card = document.createElement('div');
    card.className = 'export-card';

    const name = exp.data.experimentName || 'ניסוי ללא שם';
    const site = exp.data.experimentSite || '';
    const dateStr = formatDateIL(exp.data.createdAt);
    const badge = exp.shared
        ? (isAdmin && exp.ownerUid !== currentUser.uid
            ? '<span class="export-badge shared"><i class="fas fa-user"></i> של משתמש אחר</span>'
            : '<span class="export-badge shared"><i class="fas fa-users"></i> שותף</span>')
        : '<span class="export-badge owner"><i class="fas fa-user-check"></i> שלי</span>';

    card.innerHTML = `
        <div class="export-card-header">
            <div class="export-card-title"><i class="fas fa-flask"></i><span>${name}</span>${badge}</div>
            <div class="export-card-meta">
                ${dateStr ? `<span><i class="fas fa-calendar-alt"></i>${dateStr}</span>` : ''}
                ${site ? `<span><i class="fas fa-map-marker-alt"></i>${site}</span>` : ''}
                ${exp.data.leadResearcher ? `<span><i class="fas fa-user"></i>${exp.data.leadResearcher}</span>` : ''}
            </div>
        </div>
        <div class="export-card-actions">
            <button class="btn-export excel" data-type="excel" title="הורדת Excel עם כל נתוני הניסוי">
                <i class="fas fa-file-excel"></i>
                <span>להורדת Excel</span>
            </button>
            <button class="btn-export zip" data-type="zip" title="הורדת ZIP — Excel + כל הקבצים המצורפים">
                <i class="fas fa-file-archive"></i>
                <span>להורדת ZIP (Excel + קבצים)</span>
            </button>
        </div>
        <div class="export-progress" id="progress-${exp.id}">
            <i class="fas fa-spinner fa-spin"></i>
            <span class="progress-text">מכין קבצים...</span>
        </div>
    `;

    card.querySelector('[data-type="excel"]').addEventListener('click', (e) => handleExport(e, exp, 'excel'));
    card.querySelector('[data-type="zip"]').addEventListener('click', (e) => handleExport(e, exp, 'zip'));

    return card;
}

// ══════════════════════════════════════════
// Handle Export
// ══════════════════════════════════════════
async function handleExport(e, exp, type) {
    // Enforce read permission before exporting
    if (!canRead(exp.data, currentUser, userData, getTrustedNow(), exp.ownerUid)) {
        showToast('אין הרשאה לצפות בניסוי זה', 'error');
        return;
    }
    const btn = e.currentTarget;
    const card = btn.closest('.export-card');
    const progressEl = card.querySelector('.export-progress');
    const progressText = progressEl?.querySelector('.progress-text');
    const allBtns = card.querySelectorAll('.btn-export');

    allBtns.forEach(b => b.disabled = true);
    if (progressEl) progressEl.classList.add('active');

    try {
        const setProgress = (msg) => { if (progressText) progressText.textContent = msg; };

        setProgress('שולף נתוני ניסוי...');
        const data = exp.data;

        setProgress('בונה קובץ Excel...');
        const wb = buildExcelWorkbook(data);

        if (type === 'excel') {
            const fileName = sanitizeFileName(data.experimentName || 'experiment') + '.xlsx';
            XLSX.writeFile(wb, fileName);
            showToast('קובץ Excel הורד בהצלחה!', 'success');

        } else {
            setProgress('מכין קובץ ZIP...');
            const zip = new JSZip();

            const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const excelName = sanitizeFileName(data.experimentName || 'experiment') + '.xlsx';
            zip.file(excelName, xlsxData);

            setProgress('מוריד קבצים מ-Storage...');
            await addStorageFilesToZip(zip, exp, setProgress);


            setProgress('יוצר קובץ ZIP...');
            const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
                setProgress(`יוצר ZIP... ${Math.round(metadata.percent)}%`);
            });

            const zipName = sanitizeFileName(data.experimentName || 'experiment') + '.zip';
            saveAs(zipBlob, zipName);
            showToast('קובץ ZIP הורד בהצלחה!', 'success');
        }
    } catch (err) {
        console.error("Export error:", err);
        showToast('שגיאה בייצוא: ' + err.message, 'error');
    } finally {
        allBtns.forEach(b => b.disabled = false);
        if (progressEl) progressEl.classList.remove('active');
    }
}

// ══════════════════════════════════════════════════════════════════
// Build Excel — ONE sheet, organized with section headers
// ══════════════════════════════════════════════════════════════════
function buildExcelWorkbook(data) {
    const wb = XLSX.utils.book_new();
    const rows = [];
    const treatmentsCount = Math.max(
        1,
        parseInt(data.treatmentsCount) || 0,
        Array.isArray(data.treatments) ? data.treatments.length : 0
    );

    function addSection(title) {
        rows.push([]);
        rows.push(['═══  ' + title + '  ═══']);
        rows.push([]);
    }
    function addField(label, value) {
        rows.push([label, value !== undefined && value !== null ? String(value) : '']);
    }
    function addTable(headers, dataRows) {
        rows.push(headers);
        dataRows.forEach(r => rows.push(r));
        rows.push([]);
    }
    function deepClone(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }
    function getTreatmentRepeatNumber(treatment, index) {
        const fromLabel = String(treatment?.repeatLabel || '').trim();
        const labelMatch = fromLabel.match(/(\d+)/);
        if (labelMatch) {
            const fromRepeatLabel = parseInt(labelMatch[1]);
            if (Number.isFinite(fromRepeatLabel) && fromRepeatLabel > 0) return fromRepeatLabel;
        }
        const parsed = parseInt(treatment?.repeatNumber);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const legacy = String(treatment?.pesticide || '').trim();
        const match = legacy.match(/(\d+)/);
        if (match) {
            const fromLegacy = parseInt(match[1]);
            if (Number.isFinite(fromLegacy) && fromLegacy > 0) return fromLegacy;
        }
        return index + 1;
    }
    function getTreatmentRepeatLabel(treatment, index) {
        const explicitLabel = String(treatment?.repeatLabel || '').trim();
        if (explicitLabel) return explicitLabel;
        return `חזרה ${getTreatmentRepeatNumber(treatment, index)}`;
    }
    function getTreatmentRepeatDisplay(treatment, index) {
        const labels = Array.isArray(treatment?.repeatLabels)
            ? treatment.repeatLabels.map(label => String(label || '').trim()).filter(Boolean)
            : [];

        if (labels.length > 0) {
            return labels.join(', ');
        }

        return getTreatmentRepeatLabel(treatment, index);
    }
    function normalizeYieldData(rawYieldData = {}) {
        return {
            measures: Array.isArray(rawYieldData?.measures) ? deepClone(rawYieldData.measures) : [],
            damages: Array.isArray(rawYieldData?.damages) ? deepClone(rawYieldData.damages) : []
        };
    }
    function getTreatmentTitle(index) {
        const t = data.treatments?.[index] || {};
        if (t.name) return `טיפול ${index + 1} - ${t.name}`;
        return `טיפול ${index + 1}`;
    }
    function resolveSectionState(sectionId, legacyShared, legacyData) {
        const model = data.sectionSharedState?.[sectionId];
        let shared = legacyShared !== false;
        let sharedData = deepClone(legacyData || {});
        let byTreatment = [];

        if (model) {
            shared = model.shared !== false;
            sharedData = deepClone(model.sharedData || model.data || sharedData || {});
            byTreatment = Array.isArray(model.byTreatment) ? deepClone(model.byTreatment) : [];
        }

        while (byTreatment.length < treatmentsCount) {
            byTreatment.push(deepClone(sharedData || {}));
        }

        return {
            shared,
            sharedData,
            byTreatment
        };
    }
    function renderPerTreatment(sectionState, renderCb) {
        for (let i = 0; i < treatmentsCount; i++) {
            rows.push([]);
            rows.push([getTreatmentTitle(i)]);
            renderCb(sectionState.byTreatment[i] || {}, i);
        }
    }

    // ── 1. תוכנית הניסוי ──
    addSection('תוכנית הניסוי');
    addField('שם הניסוי', data.experimentName);
    addField('חוקר מוביל', data.leadResearcher);
    addField('שותפים', (data.partners || []).map(p => `${p.name} (${p.email})`).join(', '));
    addField('שנת ניסוי', data.experimentYear);
    addField('חודש ניסוי', data.experimentMonth);
    addField('תאריך תחילה', data.startDate);
    addField('סוג מחקר', data.studyType === 'lab' ? 'מחקר מעבדה' : 'מחקר שדה');
    addField('חבילת עבודה', data.workPackage);
    addField('אתר הניסוי', data.experimentSite);
    addField('קורדינטות', data.studyType === 'field' ? data.siteCoordinates : '');
    addField("מס' תא", data.studyType === 'lab' ? data.labCellNumber : '');
    addField('מטרת הניסוי', data.experimentGoal);
    addField('תקציר', data.experimentSummary);
    addField('מספר טיפולים', data.treatmentsCount);
    addField('מספר חזרות', data.repetitionsCount);
    addField('משתנים בלתי תלויים', (data.independentVariables || []).join(', '));
    addField('מספר רמות', data.levelsCount);
    addField('ערך', data.levelValue);
    addField('משתנים תלויים', (data.dependentVariables || []).join(', '));
    addField('מילות מפתח', (data.keywords || []).join(', '));

    if (data.treatments && data.treatments.length > 0) {
        rows.push([]);
        rows.push(['פרטי טיפולים:']);
        addTable(
            ['מספר', 'שם הטיפול', 'חזרות'],
            data.treatments.map((t, i) => [i + 1, t.name || '', getTreatmentRepeatDisplay(t, i)])
        );
    }

    // ── 2. הכנות לניסוי > פרטי הגידול ──
    const cropState = resolveSectionState('crop', data.cropDetails?.shared, data.cropDetails?.data || {});
    addSection('הכנות לניסוי > פרטי הגידול');
    addField('נתונים משותפים לכל הטיפולים', cropState.shared ? 'כן' : 'לא');
    const isLabStudy = data.studyType === 'lab';
    const renderCropFields = (crop) => {
        addField('מועד שתילה', crop.plantingDate);
        addField('מועד הדבקה 1', crop.inoculationDate1);
        addField('מועד הדבקה 2', crop.inoculationDate2);
        addField('סוג גידול', crop.cropType);
        addField('זן', crop.variety);
        addField('צמח מורכב', crop.graftedPlant);
        addField('סוג הזן', crop.varietyType);
        addField('צמח מפוצל', crop.splitPlant);
        addField('משתלה', crop.nursery);
        addField('כמות שתילים', crop.seedlingsCount);
        if (isLabStudy) {
            addField("מס' עציצים", crop.potsCount);
            addField("מס' שתילים בעציץ", crop.seedlingsPerPot);
        } else {
            addField('עומד שתילה', crop.plantingDensity);
        }
        addField('מבנה שתילה', crop.plantingStructure);
        addField('שטח הניסוי (דונם)', crop.experimentArea);
        addField('שם הכנה', crop.preparationName);
        addField('הערות', crop.notes);
    };
    if (cropState.shared) {
        renderCropFields(cropState.sharedData || cropState.byTreatment[0] || {});
    } else {
        renderPerTreatment(cropState, renderCropFields);
    }

    // ── 3. הכנות לניסוי > מבנה ──
    const structureState = resolveSectionState('structure', data.structureDetails?.shared, data.structureDetails?.data || {});
    addSection('הכנות לניסוי > מבנה');
    addField('נתונים משותפים לכל הטיפולים', structureState.shared ? 'כן' : 'לא');
    const renderStructureFields = (structure) => {
        addField('סוג המבנה', structure.type);
        addField('גודל מבנה (מטר)', structure.size);
        addField('חיפוי גג', structure.roofCovering);
        addField("טמפ' תא - מצב", structure.cellTempMode);
        addField("טמפ' תא - קבועה", structure.cellTempFixed);
        addField("טמפ' תא - מינימום (לילה)", structure.cellTempMinNight);
        addField("טמפ' תא - מקסימום (יום)", structure.cellTempMaxDay);
        addField('מפנה המבנה', structure.direction);
        addField('פעולות חריגות', structure.notes);
    };
    if (structureState.shared) {
        renderStructureFields(structureState.sharedData || structureState.byTreatment[0] || {});
    } else {
        renderPerTreatment(structureState, renderStructureFields);
    }

    // ── 4. הכנות לניסוי > טיפול בקרקע ──
    const soilState = resolveSectionState('soil', data.soilDetails?.shared, data.soilDetails?.data || {});
    addSection('הכנות לניסוי > טיפול בקרקע');
    addField('נתונים משותפים לכל הטיפולים', soilState.shared ? 'כן' : 'לא');
    const renderSoilFields = (soil) => {
        addField('מצע מנותק', soil.detachedSubstrate);
        addField('סוג החברה', soil.substrateCompany);
        addField('סוג המצע', soil.substrateType);
        addField('נפח המצע לעציץ', soil.substrateVolume);
        addField('חיטוי בהמטרה אדיגן', soil.disinfectionAdigan);
        addField('כמות אדיגן', soil.adiganAmount);

        if (soil.compostRows?.length > 0) {
            rows.push([]); rows.push(['פיזור קומפוסט:']);
            addTable(['תאריך', 'כמות', 'אופן יישום'], soil.compostRows.map(r => [r.date || '', r.amount || '', r.method || '']));
        }
        if (soil.disinfectRows?.length > 0) {
            rows.push(['חיטוי קרקע:']);
            addTable(['תאריך', 'חומר החיטוי', 'כמות', 'אופן יישום'], soil.disinfectRows.map(r => [r.date || '', r.material || '', r.amount || '', r.method || '']));
        }
    };
    if (soilState.shared) {
        renderSoilFields(soilState.sharedData || soilState.byTreatment[0] || {});
    } else {
        renderPerTreatment(soilState, renderSoilFields);
    }

    // ── 5. הכנות לניסוי > סוג ופריסת הטפטוף ──
    const dripState = resolveSectionState('drip', data.dripDetails?.shared, data.dripDetails?.data || {});
    addSection('הכנות לניסוי > סוג ופריסת הטפטוף');
    addField('נתונים משותפים לכל הטיפולים', dripState.shared ? 'כן' : 'לא');
    const renderDripFields = (drip) => {
        addField('שלוחה בודדת/כפולה', drip.singleDouble);
        addField('קוטר צינור טפטוף', drip.pipeDiameter);
        addField('סוג', drip.type);
        addField('מרחק בין טפטפות (ס"מ)', drip.emitterSpacing);
        addField('ספיקה (ליטר/שעה)', drip.flowRate);
        addField('משך השקייה (דקות)', drip.irrigationDurationMinutes);
        addField("מס' השקיות ביום", drip.irrigationsPerDay);
        addField('שעות השקיה', Array.isArray(drip.irrigationTimes) ? drip.irrigationTimes.join(', ') : '');
        addField('מס\' שלוחות (יח\')', drip.linesCount);
    };
    if (dripState.shared) {
        renderDripFields(dripState.sharedData || dripState.byTreatment[0] || {});
    } else {
        renderPerTreatment(dripState, renderDripFields);
    }

    // ── 6. מהלך הניסוי > השקיה ודשן ──
    const irrigationState = resolveSectionState('irrigation', true, {
        irrigationData: data.irrigationData || [],
        fertilizationData: data.fertilizationData || []
    });
    addSection('מהלך הניסוי > השקיה ודשן');
    addField('נתונים משותפים לכל הטיפולים', irrigationState.shared ? 'כן' : 'לא');
    const renderIrrigationFields = (sectionData) => {
        const irrigationData = sectionData.irrigationData || [];
        if (irrigationData.length > 0) {
            rows.push(['השקיה:']);
            addTable(
                ['שם הקובץ', 'תאריך העלאה', 'תאריכי מדידה', 'סה"כ כמות מים (ליטר)', 'קישור קובץ'],
                irrigationData.map(r => [r.fileName || '', r.uploadDate || '', r.measureDates || '', r.totalWater || '', r.fileUrl || ''])
            );
        } else {
            addField('השקיה', 'אין נתונים');
        }

        const fertilizationData = sectionData.fertilizationData || [];
        if (fertilizationData.length > 0) {
            rows.push(['דישון:']);
            addTable(
                ['שם הקובץ', 'תאריך העלאה', 'תאריכי מדידה', 'סוג הדשן', 'חברה', 'סה"כ כמות דשן', 'קישור קובץ'],
                fertilizationData.map(r => [r.fileName || '', r.uploadDate || '', r.measureDates || '', r.fertType || '', r.company || '', r.totalFert || '', r.fileUrl || ''])
            );
        } else {
            addField('דישון', 'אין נתונים');
        }
    };
    if (irrigationState.shared) {
        renderIrrigationFields(irrigationState.sharedData || irrigationState.byTreatment[0] || {});
    } else {
        renderPerTreatment(irrigationState, renderIrrigationFields);
    }

    // ── 7. מהלך הניסוי > צימוח ──
    const growthState = resolveSectionState('growth', true, { growthData: data.growthData || [] });
    addSection('מהלך הניסוי > צימוח');
    addField('נתונים משותפים לכל הטיפולים', growthState.shared ? 'כן' : 'לא');
    const renderGrowthFields = (sectionData) => {
        const growthData = sectionData.growthData || [];
        if (growthData.length > 0) {
            addTable(['נתון', 'ערך', 'תאריך מדידה'], growthData.map(r => [r.name || '', r.value || '', r.measureDate || '']));
        } else {
            addField('צימוח', 'אין נתונים');
        }
    };
    if (growthState.shared) {
        renderGrowthFields(growthState.sharedData || growthState.byTreatment[0] || {});
    } else {
        renderPerTreatment(growthState, renderGrowthFields);
    }

    // ── 8. מהלך הניסוי > נתוני אקלים וסנסורים ──
    const climateState = resolveSectionState('climate', true, { climateData: data.climateData || [] });
    addSection('מהלך הניסוי > נתוני אקלים וסנסורים');
    addField('נתונים משותפים לכל הטיפולים', climateState.shared ? 'כן' : 'לא');
    const renderClimateFields = (sectionData) => {
        const climateData = sectionData.climateData || [];
        if (climateData.length > 0) {
            addTable(
                ['נתון', 'מיקום מדידה', 'מיקום חיישן במרחב', 'גובה/עומק חיישן', 'תאריכי מדידה', 'הערות'],
                climateData.map(r => [r.name || '', r.location || '', r.sensorPosition || '', r.sensorDepth || '', r.measureDates || '', r.notes || ''])
            );
        } else {
            addField('אקלים', 'אין נתונים');
        }
    };
    if (climateState.shared) {
        renderClimateFields(climateState.sharedData || climateState.byTreatment[0] || {});
    } else {
        renderPerTreatment(climateState, renderClimateFields);
    }

    // ── 9. מהלך הניסוי > אגרוטכניקה ──
    const agroState = resolveSectionState('agrotechnics', true, { agrotechnicsData: data.agrotechnicsData || [] });
    addSection('מהלך הניסוי > אגרוטכניקה');
    addField('נתונים משותפים לכל הטיפולים', agroState.shared ? 'כן' : 'לא');
    const renderAgroFields = (sectionData) => {
        const agroData = sectionData.agrotechnicsData || [];
        if (agroData.length > 0) {
            addTable(
                ['פעולה', 'תאריך ביצוע הפעולה', 'כמות שעות לפעולה', 'כמות עובדים לפעולה'],
                agroData.map(r => [r.action === 'אחר' ? `${r.action} - ${r.actionOther || ''}` : (r.action || ''), r.actionDate || '', r.hours || '', r.workers || ''])
            );
        } else {
            addField('אגרוטכניקה', 'אין נתונים');
        }
    };
    if (agroState.shared) {
        renderAgroFields(agroState.sharedData || agroState.byTreatment[0] || {});
    } else {
        renderPerTreatment(agroState, renderAgroFields);
    }

    // ── 10. מהלך הניסוי > הגנת הצומח ──
    const plantProtectionState = resolveSectionState('plantProtection', true, {
        plantProtectionData: data.plantProtectionData || {}
    });
    addSection('מהלך הניסוי > הגנת הצומח');
    addField('נתונים משותפים לכל הטיפולים', plantProtectionState.shared ? 'כן' : 'לא');
    const renderPlantProtection = (sectionData) => {
        const pp = sectionData.plantProtectionData || {};
        const pests = pp.pests || [];
        if (pests.length > 0) { rows.push(['מזיקים:']); addTable(['מפגע', 'תאריך', 'סוג האילוח', 'שיטת האילוח', 'כמות האילוח', 'הערות'], pests.map(r => [r.pest || '', r.date || '', r.inoculationType || '', r.inoculationMethod || '', r.inoculationAmount || '', r.notes || ''])); }
        const diseases = pp.diseases || [];
        if (diseases.length > 0) { rows.push(['מחלות:']); addTable(['מפגע', 'תאריך', 'סוג האילוח', 'שיטת האילוח', 'כמות האילוח', 'הערות'], diseases.map(r => [r.pest || '', r.date || '', r.inoculationType || '', r.inoculationMethod || '', r.inoculationAmount || '', r.notes || ''])); }
        const sprays = pp.sprays || [];
        if (sprays.length > 0) { rows.push(['ריסוסים:']); addTable(['חומר', 'תאריך', 'מינון לטיפול', 'משולב עם חומרים נוספים', 'הערות'], sprays.map(r => [r.material || '', r.date || '', r.dosage || '', r.combined || '', r.notes || ''])); }
        const drenches = pp.drenches || [];
        if (drenches.length > 0) { rows.push(['הגמעות:']); addTable(['חומר', 'תאריך', 'מינון לטיפול', 'משולב עם חומרים נוספים', 'הערות'], drenches.map(r => [r.material || '', r.date || '', r.dosage || '', r.combined || '', r.notes || ''])); }
        if (pests.length === 0 && diseases.length === 0 && sprays.length === 0 && drenches.length === 0) {
            addField('הגנת הצומח', 'אין נתונים');
        }
    };
    if (plantProtectionState.shared) {
        renderPlantProtection(plantProtectionState.sharedData || plantProtectionState.byTreatment[0] || {});
    } else {
        renderPerTreatment(plantProtectionState, renderPlantProtection);
    }

    // ── 11. נתוני יבול ──
    const legacyYield = data.yieldData || {};
    let yieldState = resolveSectionState('yield', true, {
        yieldData: normalizeYieldData(legacyYield)
    });
    if (!data.sectionSharedState?.yield && Array.isArray(legacyYield.byTreatment) && legacyYield.byTreatment.length > 0) {
        const byTreatment = legacyYield.byTreatment.map((entry) => ({
            yieldData: normalizeYieldData(entry?.yieldData || entry)
        }));
        yieldState = {
            shared: false,
            sharedData: deepClone(byTreatment[0] || { yieldData: normalizeYieldData() }),
            byTreatment
        };
    }
    addSection('נתוני יבול');
    addField('נתונים משותפים לכל הטיפולים', yieldState.shared ? 'כן' : 'לא');
    const renderYieldFields = (entry) => {
        const yd = normalizeYieldData(entry?.yieldData || entry || {});
        const measures = yd.measures || [];
        if (measures.length > 0) {
            rows.push(['מדידות יבול:']);
            addTable(
                ['תאריך מדידה', 'מספר חזרות', 'קומת הפרי', 'איכות (לק"ג)', 'כמות (ק"ג)', 'תיאור הפרי', 'הערות'],
                measures.map(r => [r.measureDate || '', r.repeatCount || '', r.fruitFloor || '', r.quality || '', r.quantity || '', r.fruitDesc || '', r.notes || ''])
            );
        }
        const damages = yd.damages || [];
        if (damages.length > 0) {
            rows.push(['נזקי יבול:']);
            addTable(
                ['תאריך מדידה', 'מספר חזרות', 'הפגע הנמדד', 'מדד נזק (%/ס"מ/No.)', 'ערך הנזק', 'תיאור הנזק'],
                damages.map(r => [r.measureDate || '', r.repeatCount || '', r.damage || '', r.damageIndex || '', r.damageValue || '', r.damageDesc || ''])
            );
        }
        if (measures.length === 0 && damages.length === 0) {
            addField('נתוני יבול', 'אין נתונים');
        }
    };
    if (yieldState.shared) {
        renderYieldFields(yieldState.sharedData || yieldState.byTreatment[0] || {});
    } else {
        renderPerTreatment(yieldState, renderYieldFields);
    }

    // ── 12. יומן אירועים ──
    const events = data.events || [];
    addSection('יומן אירועים');
    if (events.length > 0) {
        addTable(['תאריך', 'תיאור', 'שם קובץ', 'קישור קובץ'], events.map(e => [e.date || '', e.description || '', e.fileName || '', e.fileUrl || '']));
    } else { addField('אירועים', 'אין נתונים'); }

    // ── Build sheet ──
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 35 }, { wch: 30 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 45 }];

    // Set sheet to RTL for Hebrew
    if (!ws['!sheetViews']) ws['!sheetViews'] = [{}];
    ws['!sheetViews'][0].rightToLeft = true;

    XLSX.utils.book_append_sheet(wb, ws, 'ניסוי מלא');

    // Set workbook views to RTL
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Views) wb.Workbook.Views = [{}];
    wb.Workbook.Views[0].RTL = true;

    return wb;
}

// ══════════════════════════════════════════════════════════════
// Fetch ALL files from Firebase Storage into ZIP (recursive)
// Uses Firebase SDK getBlob() — authenticated, no CORS issues
// Maps English Storage folder names to Hebrew for the ZIP
// ══════════════════════════════════════════════════════════════

// Map Storage folder names (English) to Hebrew display names
const FOLDER_NAME_MAP = {
    'events': 'אירועים',
    'irrigation': 'השקיה',
    'fertilization': 'דישון',
    'growth': 'צימוח',
    'climate': 'אקלים',
    'agrotechnics': 'אגרוטכניקה',
    'protection': 'הגנת_הצומח',
    'yield': 'יבול'
};

async function addStorageFilesToZip(zip, exp, setProgress) {
    const filesFolder = zip.folder('קבצים_מצורפים');
    let fileCount = 0;
    let errorCount = 0;

    async function scanFolder(storageRef, zipFolder) {
        let result;
        try {
            result = await listAll(storageRef);
        } catch (err) {
            console.warn(`Cannot list: ${storageRef.fullPath}`, err.message);
            return;
        }

        for (const itemRef of result.items) {
            try {
                fileCount++;
                setProgress(`מוריד קובץ ${fileCount}: ${itemRef.name}`);
                const blob = await getBlob(itemRef);
                zipFolder.file(itemRef.name, blob);
            } catch (fileErr) {
                errorCount++;
                console.error(`Failed to download ${itemRef.fullPath}:`, fileErr.message);
            }
        }

        for (const prefixRef of result.prefixes) {
            // Use Hebrew folder name if mapped, otherwise keep original
            const hebrewName = FOLDER_NAME_MAP[prefixRef.name] || prefixRef.name;
            const subFolder = zipFolder.folder(hebrewName);
            await scanFolder(prefixRef, subFolder);
        }
    }

    const storagePath = `users/${exp.ownerUid}/experiments/${exp.id}`;
    const storageRef = ref(storage, storagePath);
    await scanFolder(storageRef, filesFolder);

    if (fileCount === 0) {
        setProgress('אין קבצים מצורפים ב-Storage');
    } else if (errorCount > 0) {
        setProgress(`${fileCount - errorCount}/${fileCount} קבצים הורדו (${errorCount} שגיאות)`);
        showToast(`${errorCount} קבצים לא הורדו — בדוק הרשאות Storage`, 'warning');
    } else {
        setProgress(`סה"כ ${fileCount} קבצים מ-Storage נוספו ל-ZIP`);
    }
}


// ── Helpers ──
function sanitizeFileName(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').substring(0, 100);
}


