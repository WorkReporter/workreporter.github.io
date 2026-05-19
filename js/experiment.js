// js/experiment.js
import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    doc,
    getDoc,
    updateDoc,
    setDoc,
    deleteDoc,
    serverTimestamp,
    collection,
    getDocs,
    query,
    limit,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    ref,
    uploadBytesResumable,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { showToast, showConfirmModal, showInfoModal, showThreeOptionModal } from "./toast.js";
import { initExperimentTour } from "./experiment-tour.js";
import { initServerTime, getTrustedNow } from "./server-time.js";
import {
    canRead,
    canEdit,
    canManage,
    getRole
} from "./permissions-utils.js";

document.addEventListener('DOMContentLoaded', () => {
    initExperimentTour();
});


// =========================================
// State
// =========================================
let currentUser = null;
let userData = null;
let currentExperimentId = null;
let experimentData = null;
let currentView = 'basic';
let currentTreatmentIndex = 0;
let allUsers = []; // All users for partner selection
let selectedPartner = null; // Currently selected partner from autocomplete
let experimentOwnerUid = null; // מזהה הבעלים של הניסוי (יכול להיות שונה מהמשתמש הנוכחי אם זה ניסוי משותף)
let permissionsState = {
    canRead: false,
    canEdit: false,
    canManage: false,
    role: 'none'
};
let isSharedExperiment = false; // האם זה ניסוי שאני שותף בו
let sharedSectionState = {};
let isSyncingSharedToggle = false;
let lastSavedFormSignature = '';
let scrollPersistTimeoutId = null;
let isNavigationStateReady = false;
let hasUserEditedSinceSave = false;
let isBrowserNavGuardInitialized = false;
let skipNextPopstateGuard = false;

const SHARED_VIEW_TO_SECTION = {
    crop: 'crop',
    structure: 'structure',
    soil: 'soil',
    drip: 'drip',
    irrigation: 'irrigation',
    growth: 'growth',
    climate: 'climate',
    agrotechnics: 'agrotechnics',
    'plant-protection': 'plantProtection',
    yield: 'yield'
};

const SHARED_SECTION_IDS = Object.values(SHARED_VIEW_TO_SECTION);

const SITE_PRESET_VALUES = ['volcani-bet-dagan', 'mop-darom', 'gilat'];
const STUDY_TYPES = ['field', 'lab'];
const DYNAMIC_FIELD_CONFIG = {
    experimentSiteOther: { datalistId: 'datalist-experiment-site-other' },
    cropType: { datalistId: 'datalist-crop-type' },
    variety: { datalistId: 'datalist-variety' },
    nursery: { datalistId: 'datalist-nursery' },
    substrateCompany: { datalistId: 'datalist-substrate-company' },
    substrateType: { datalistId: 'datalist-substrate-type' },
    soilDisinfectionMaterial: { datalistId: 'datalist-soil-disinfection-material' },
    fertilizerType: { datalistId: 'datalist-fertilizer-type' },
    fertilizerCompany: { datalistId: 'datalist-fertilizer-company' },
    plantProtectionMaterial: { datalistId: 'datalist-plant-protection-material' }
};
let dynamicFieldOptions = getDefaultDynamicFieldOptions();

function getDefaultDynamicFieldOptions() {
    return Object.keys(DYNAMIC_FIELD_CONFIG).reduce((acc, key) => {
        acc[key] = [];
        return acc;
    }, {});
}

function normalizeDynamicValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

function getCurrentStudyType() {
    const value = document.getElementById('study-type')?.value;
    return STUDY_TYPES.includes(value) ? value : 'field';
}

function setStudyTypeValue(nextValue) {
    const input = document.getElementById('study-type');
    if (!input) return;
    input.value = STUDY_TYPES.includes(nextValue) ? nextValue : 'field';
    syncStudyTypeToggle();
}

function syncStudyTypeToggle() {
    const current = getCurrentStudyType();
    document.querySelectorAll('.study-type-option').forEach((button) => {
        const isActive = button.dataset.studyType === current;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function getTreatmentRepeatNumber(treatment, index = 0) {
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

function getTreatmentRepeatLabel(treatment, index = 0) {
    const explicitLabel = String(treatment?.repeatLabel || '').trim();
    if (explicitLabel) return explicitLabel;

    return `חזרה ${getTreatmentRepeatNumber(treatment, index)}`;
}

const MAX_REPETITIONS_PER_TREATMENT = 100;

function getCurrentRepetitionsCount() {
    const repetitionsInput = document.getElementById('repetitions-count');
    const fromInput = parseInt(document.getElementById('repetitions-count')?.value);
    if (Number.isFinite(fromInput) && fromInput > 0) {
        const clampedInput = Math.min(fromInput, MAX_REPETITIONS_PER_TREATMENT);
        if (repetitionsInput && String(clampedInput) !== String(repetitionsInput.value)) {
            repetitionsInput.value = String(clampedInput);
        }
        return clampedInput;
    }

    const fromData = parseInt(experimentData?.repetitionsCount);
    if (Number.isFinite(fromData) && fromData > 0) {
        return Math.min(fromData, MAX_REPETITIONS_PER_TREATMENT);
    }

    return 1;
}

function getTreatmentRepeatLabels(treatment, treatmentIndex = 0, repetitionsCount = getCurrentRepetitionsCount()) {
    const count = Math.min(MAX_REPETITIONS_PER_TREATMENT, Math.max(1, parseInt(repetitionsCount) || 0));
    const explicitLabels = Array.isArray(treatment?.repeatLabels) ? treatment.repeatLabels : [];
    const labels = [];

    for (let i = 0; i < count; i++) {
        const explicitLabel = String(explicitLabels[i] ?? '').trim();
        labels.push(explicitLabel || `חזרה ${i + 1}`);
    }

    if (!labels.length) {
        labels.push(getTreatmentRepeatLabel(treatment, treatmentIndex));
    }

    return labels;
}

function getYieldRepeatOptionsForTreatment(treatmentIndex = currentTreatmentIndex) {
    const treatments = Array.isArray(experimentData?.treatments) ? experimentData.treatments : [];
    const safeIndex = Number.isFinite(parseInt(treatmentIndex, 10)) ? parseInt(treatmentIndex, 10) : 0;
    const treatment = treatments[safeIndex] || treatments[0] || null;

    return normalizeUniqueValues(getTreatmentRepeatLabels(treatment, safeIndex, getCurrentRepetitionsCount()));
}

function collectTreatmentInputsFromDOM() {
    const treatments = [];

    document.querySelectorAll('.treatment-item').forEach((item) => {
        const index = parseInt(item.dataset.index);
        if (!Number.isFinite(index)) return;

        const nameInput = item.querySelector('.treatment-name');
        const repeatInputs = Array.from(item.querySelectorAll('.treatment-repeat'))
            .sort((a, b) => parseInt(a.dataset.repeatIndex) - parseInt(b.dataset.repeatIndex));

        const repeatLabels = repeatInputs.map((repeatInput, repeatIndex) => {
            const fallbackLabel = `חזרה ${repeatIndex + 1}`;
            return String(repeatInput?.value || '').trim() || fallbackLabel;
        });

        treatments[index] = {
            name: nameInput?.value || '',
            repeatLabels,
            repeatLabel: repeatLabels[0] || '',
            repeatNumber: repeatLabels.length || 1
        };
    });

    return treatments.filter(Boolean);
}

function normalizeYieldData(rawYieldData = {}) {
    return {
        measures: Array.isArray(rawYieldData?.measures) ? deepClone(rawYieldData.measures) : [],
        damages: Array.isArray(rawYieldData?.damages) ? deepClone(rawYieldData.damages) : []
    };
}

function normalizeYieldSectionEntry(entry = {}) {
    return {
        yieldData: normalizeYieldData(entry?.yieldData || entry)
    };
}

function getYieldDataForTreatment(data, treatmentIndex = 0) {
    const sectionYield = data?.sectionSharedState?.yield;
    if (sectionYield) {
        if (sectionYield.shared !== false) {
            return normalizeYieldData(
                sectionYield.sharedData?.yieldData ||
                sectionYield.data?.yieldData ||
                sectionYield.sharedData ||
                sectionYield.data ||
                {}
            );
        }
        const byTreatmentEntry = sectionYield.byTreatment?.[treatmentIndex] || sectionYield.byTreatment?.[0] || {};
        return normalizeYieldData(byTreatmentEntry?.yieldData || byTreatmentEntry);
    }

    const rootYield = data?.yieldData || {};
    if (Array.isArray(rootYield.byTreatment) && rootYield.byTreatment.length > 0) {
        const byTreatmentEntry = rootYield.byTreatment[treatmentIndex] || rootYield.byTreatment[0] || {};
        return normalizeYieldData(byTreatmentEntry?.yieldData || byTreatmentEntry);
    }

    return normalizeYieldData(rootYield);
}

function getComparableFormData(formData) {
    const comparable = deepClone(formData) || {};
    delete comparable.updatedAt;
    return comparable;
}

function getFormSignatureFromData(formData) {
    try {
        return JSON.stringify(getComparableFormData(formData));
    } catch (error) {
        console.warn('Could not serialize form data signature:', error);
        return '';
    }
}

function getCurrentFormSignature() {
    return getFormSignatureFromData(collectFormData());
}

function setLastSavedFormSignatureFromCurrent() {
    lastSavedFormSignature = getCurrentFormSignature();
    hasUserEditedSinceSave = false;
}

function markUserEdited() {
    hasUserEditedSinceSave = true;
}

function hasUnsavedChanges() {
    if (!hasUserEditedSinceSave) return false;
    if (!lastSavedFormSignature) return false;
    return getCurrentFormSignature() !== lastSavedFormSignature;
}

function getNavigationStateStorageKey() {
    if (!currentExperimentId || !experimentOwnerUid) return null;
    return `experiment-navigation-state:${experimentOwnerUid}:${currentExperimentId}`;
}

function isValidViewName(viewName) {
    if (!viewName) return false;
    return !!document.getElementById(`view-${viewName}`);
}

function persistNavigationState(force = false) {
    if (!isNavigationStateReady && !force) return;

    const key = getNavigationStateStorageKey();
    if (!key) return;

    const state = {
        view: currentView,
        treatmentIndex: currentTreatmentIndex,
        scrollY: window.scrollY || window.pageYOffset || 0,
        savedAt: Date.now()
    };

    try {
        sessionStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
        console.warn('Could not persist experiment navigation state:', error);
    }
}

function schedulePersistNavigationState() {
    if (scrollPersistTimeoutId) {
        clearTimeout(scrollPersistTimeoutId);
    }
    scrollPersistTimeoutId = setTimeout(() => {
        persistNavigationState();
        scrollPersistTimeoutId = null;
    }, 120);
}

function getSavedNavigationState() {
    const key = getNavigationStateStorageKey();
    if (!key) return null;

    try {
        const raw = sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('Could not read experiment navigation state:', error);
        return null;
    }
}

function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburgerBtn = document.getElementById('hamburger-btn');

    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');

    const icon = hamburgerBtn?.querySelector('i');
    if (icon) {
        icon.classList.add('fa-bars');
        icon.classList.remove('fa-times');
    }
}

function restoreNavigationState(preferredSection = '') {
    const safePreferredSection = isValidViewName(preferredSection) ? preferredSection : '';
    const saved = getSavedNavigationState();
    const savedView = isValidViewName(saved?.view) ? saved.view : '';
    const targetView = safePreferredSection || savedView;

    if (targetView && targetView !== currentView) {
        switchView(targetView);
    }

    const shouldApplySavedPosition = !!saved && (!safePreferredSection || saved?.view === safePreferredSection);
    if (shouldApplySavedPosition) {
        const treatmentIndex = Number(saved?.treatmentIndex);
        const count = getCurrentTreatmentsCount();

        if (Number.isInteger(treatmentIndex) && treatmentIndex >= 0 && treatmentIndex < count && treatmentIndex !== currentTreatmentIndex) {
            switchTreatmentTab(treatmentIndex);
        }

        const scrollY = Number(saved?.scrollY);
        if (Number.isFinite(scrollY) && scrollY >= 0) {
            setTimeout(() => window.scrollTo(0, scrollY), 0);
        }
    }

    persistNavigationState(true);
}

async function requestViewSwitch(viewName) {
    if (!viewName) return;

    if (viewName === currentView) {
        closeMobileSidebar();
        return;
    }

    const canProceed = await confirmUnsavedChangesBeforeAction('לא ביצעת שמירה. האם ברצונך לשמור לפני מעבר למסך הבא?');
    if (!canProceed) return;

    switchView(viewName);
    closeMobileSidebar();
}

async function confirmUnsavedChangesBeforeAction(
    message = 'לא ביצעת שמירה. האם ברצונך לשמור לפני המשך פעולה?'
) {
    if (!hasUnsavedChanges()) return true;

    const decision = await showThreeOptionModal({
        title: 'שינויים לא נשמרו',
        message,
        confirmText: 'שמור',
        alternateText: 'המשך בלי שמירה',
        cancelText: 'ביטול',
        tone: 'warning'
    });

    if (decision === 'cancel') return false;

    if (decision === 'confirm') {
        const saved = await saveExperiment();
        return saved;
    }

    return true;
}

function pushBrowserNavGuardBufferState() {
    const state = window.history.state || {};
    if (state.__experimentNavGuardBuffer === true) return;

    const bufferState = {
        ...state,
        __experimentNavGuardRoot: true,
        __experimentNavGuardBuffer: true
    };

    window.history.pushState(bufferState, '', window.location.href);
}

function initBrowserNavigationGuard() {
    if (isBrowserNavGuardInitialized) return;
    isBrowserNavGuardInitialized = true;

    const currentState = window.history.state || {};
    if (currentState.__experimentNavGuardRoot !== true) {
        window.history.replaceState({ ...currentState, __experimentNavGuardRoot: true }, '', window.location.href);
    }

    pushBrowserNavGuardBufferState();

    window.addEventListener('popstate', async () => {
        if (skipNextPopstateGuard) {
            skipNextPopstateGuard = false;
            return;
        }

        const canProceed = await confirmUnsavedChangesBeforeAction('לא ביצעת שמירה. האם ברצונך לשמור לפני חזרה/מעבר בדפדפן?');
        if (canProceed) {
            skipNextPopstateGuard = true;
            window.history.back();
            return;
        }

        pushBrowserNavGuardBufferState();
    });
}

async function confirmDeferredDeletion(itemLabel) {
    const confirmed = await showConfirmModal({
        title: 'אישור מחיקה',
        message: `האם למחוק את ${itemLabel}?\nהמחיקה בפועל תתרחש רק לאחר לחיצה על "שמירה".`,
        confirmText: 'מחק/י',
        cancelText: 'ביטול',
        tone: 'warning'
    });

    if (confirmed) {
        markUserEdited();
    }

    return confirmed;
}

function confirmImmediateDeletion(itemLabel) {
    return showConfirmModal({
        title: 'אישור מחיקה מיידית',
        message: `האם את/ה בטוח/ה שברצונך למחוק את ${itemLabel}?`,
        confirmText: 'מחק/י עכשיו',
        cancelText: 'ביטול',
        tone: 'error'
    });
}

function alertDeferredChange(changeLabel) {
    return showInfoModal({
        title: 'לתשומת ליבך',
        message: `${changeLabel} יישמר בפועל רק לאחר לחיצה על "שמירה".`,
        buttonText: 'הבנתי',
        tone: 'info'
    });
}

function getCurrentTreatmentsCount() {
    const fromInput = parseInt(document.getElementById('treatments-count')?.value);
    if (Number.isFinite(fromInput) && fromInput > 0) return fromInput;
    const fromData = parseInt(experimentData?.treatmentsCount);
    if (Number.isFinite(fromData) && fromData > 0) return fromData;
    return 1;
}

function getSectionIdByView(viewName = currentView) {
    return SHARED_VIEW_TO_SECTION[viewName] || null;
}

function getSectionModel(sectionId) {
    if (!sectionId) return null;
    if (!sharedSectionState[sectionId]) {
        sharedSectionState[sectionId] = {
            shared: true,
            sharedData: {},
            byTreatment: []
        };
    }
    return sharedSectionState[sectionId];
}

function ensureModelTreatmentLength(model, treatmentsCount = getCurrentTreatmentsCount()) {
    if (!model) return;
    if (!Array.isArray(model.byTreatment)) model.byTreatment = [];

    if (model.byTreatment.length > treatmentsCount) {
        model.byTreatment = model.byTreatment.slice(0, treatmentsCount);
    }

    while (model.byTreatment.length < treatmentsCount) {
        model.byTreatment.push(deepClone(model.sharedData || {}));
    }
}

function getSectionEffectiveData(sectionId, treatmentIndex = currentTreatmentIndex) {
    const model = getSectionModel(sectionId);
    if (!model) return {};

    ensureModelTreatmentLength(model);

    if (model.shared) {
        return deepClone(model.sharedData || {});
    }

    return deepClone(model.byTreatment[treatmentIndex] || {});
}

function setSectionCurrentData(sectionId, data, treatmentIndex = currentTreatmentIndex) {
    const model = getSectionModel(sectionId);
    if (!model) return;

    if (model.shared) {
        model.sharedData = deepClone(data || {});
        return;
    }

    ensureModelTreatmentLength(model);
    model.byTreatment[treatmentIndex] = deepClone(data || {});
}

function cloneSectionTreatment1ToAll(sectionId) {
    const model = getSectionModel(sectionId);
    if (!model) return;

    const treatmentsCount = getCurrentTreatmentsCount();
    const firstData = model.shared
        ? deepClone(model.sharedData || {})
        : deepClone(model.byTreatment[0] || model.sharedData || {});

    model.sharedData = deepClone(firstData || {});
    model.byTreatment = Array.from({ length: treatmentsCount }, () => deepClone(firstData || {}));
}

function createProgressDefaults() {
    return {
        irrigation: { irrigationData: [], fertilizationData: [] },
        growth: { growthData: [] },
        climate: { climateData: [] },
        agrotechnics: { agrotechnicsData: [] },
        plantProtection: {
            plantProtectionData: {
                pests: [],
                diseases: [],
                sprays: [],
                drenches: []
            }
        }
    };
}

function getLegacySectionDataFromExperiment(sectionId, data) {
    const progressDefaults = createProgressDefaults();

    switch (sectionId) {
        case 'crop':
            return deepClone(data?.cropDetails?.data || {});
        case 'structure':
            return deepClone(data?.structureDetails?.data || {});
        case 'soil':
            return deepClone(data?.soilDetails?.data || {});
        case 'drip':
            return deepClone(data?.dripDetails?.data || {});
        case 'irrigation':
            return {
                irrigationData: deepClone(data?.irrigationData || progressDefaults.irrigation.irrigationData),
                fertilizationData: deepClone(data?.fertilizationData || progressDefaults.irrigation.fertilizationData)
            };
        case 'growth':
            return {
                growthData: deepClone(data?.growthData || progressDefaults.growth.growthData)
            };
        case 'climate':
            return {
                climateData: deepClone(data?.climateData || progressDefaults.climate.climateData)
            };
        case 'agrotechnics':
            return {
                agrotechnicsData: deepClone(data?.agrotechnicsData || progressDefaults.agrotechnics.agrotechnicsData)
            };
        case 'plantProtection':
            return {
                plantProtectionData: deepClone(data?.plantProtectionData || progressDefaults.plantProtection.plantProtectionData)
            };
        case 'yield':
            return {
                yieldData: normalizeYieldData(data?.yieldData || {})
            };
        default:
            return {};
    }
}

function normalizeSectionModel(sectionId, data, treatmentsCount) {
    const sectionSharedState = data?.sectionSharedState?.[sectionId];
    const prepKeyMap = {
        crop: 'cropDetails',
        structure: 'structureDetails',
        soil: 'soilDetails',
        drip: 'dripDetails'
    };

    let shared = true;
    let sharedData = {};
    let byTreatment = [];

    if (sectionSharedState) {
        shared = sectionSharedState.shared !== false;
        sharedData = deepClone(sectionSharedState.sharedData || {});
        byTreatment = Array.isArray(sectionSharedState.byTreatment)
            ? deepClone(sectionSharedState.byTreatment)
            : [];
    } else if (prepKeyMap[sectionId]) {
        const block = data?.[prepKeyMap[sectionId]] || {};
        shared = block.shared !== false;
        sharedData = deepClone(block.sharedData || block.data || {});
        byTreatment = Array.isArray(block.byTreatment) ? deepClone(block.byTreatment) : [];
    } else if (sectionId === 'yield') {
        const legacyYield = data?.yieldData || {};
        shared = true;
        sharedData = { yieldData: normalizeYieldData(legacyYield) };
        byTreatment = [];

        if (Array.isArray(legacyYield.byTreatment) && legacyYield.byTreatment.length > 0) {
            shared = false;
            byTreatment = legacyYield.byTreatment.map((entry) => normalizeYieldSectionEntry(entry));
            sharedData = deepClone(byTreatment[0] || { yieldData: normalizeYieldData() });
        }
    } else {
        shared = true;
        sharedData = getLegacySectionDataFromExperiment(sectionId, data);
    }

    const model = { shared, sharedData: sharedData || {}, byTreatment: byTreatment || [] };
    ensureModelTreatmentLength(model, treatmentsCount);

    if (model.shared) {
        cloneSectionTreatment1ToAllTemp(model, treatmentsCount);
    }

    return model;
}

function cloneSectionTreatment1ToAllTemp(model, treatmentsCount = getCurrentTreatmentsCount()) {
    if (!model) return;
    const firstData = model.shared
        ? deepClone(model.sharedData || {})
        : deepClone(model.byTreatment[0] || model.sharedData || {});

    model.sharedData = deepClone(firstData || {});
    model.byTreatment = Array.from({ length: treatmentsCount }, () => deepClone(firstData || {}));
}

function initializeSharedSectionState() {
    const treatmentsCount = getCurrentTreatmentsCount();
    const data = experimentData || {};

    sharedSectionState = {};
    SHARED_SECTION_IDS.forEach((sectionId) => {
        sharedSectionState[sectionId] = normalizeSectionModel(sectionId, data, treatmentsCount);
    });
}

function syncAllSectionTreatmentCounts() {
    const treatmentsCount = getCurrentTreatmentsCount();
    SHARED_SECTION_IDS.forEach((sectionId) => {
        const model = getSectionModel(sectionId);
        ensureModelTreatmentLength(model, treatmentsCount);
        if (model.shared) {
            cloneSectionTreatment1ToAllTemp(model, treatmentsCount);
        }
    });
}

function normalizeUniqueValues(values) {
    const seen = new Set();
    const unique = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
        const normalized = normalizeDynamicValue(value);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(normalized);
    });
    return unique;
}

function setDatalistOptions(datalistId, options) {
    const datalist = document.getElementById(datalistId);
    if (!datalist) return;
    datalist.innerHTML = '';
    normalizeUniqueValues(options).forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        datalist.appendChild(option);
    });
}

function applyDynamicFieldOptionsToUI() {
    Object.entries(DYNAMIC_FIELD_CONFIG).forEach(([key, config]) => {
        setDatalistOptions(config.datalistId, dynamicFieldOptions[key]);
    });
}

function registerDynamicOption(fieldKey, value) {
    if (!DYNAMIC_FIELD_CONFIG[fieldKey]) return;
    const normalized = normalizeDynamicValue(value);
    if (!normalized) return;

    const existing = dynamicFieldOptions[fieldKey] || [];
    const hasValue = existing.some((item) => item.toLowerCase() === normalized.toLowerCase());
    if (hasValue) return;

    dynamicFieldOptions[fieldKey] = [...existing, normalized];
    setDatalistOptions(DYNAMIC_FIELD_CONFIG[fieldKey].datalistId, dynamicFieldOptions[fieldKey]);
}

function mergeDynamicFieldOptions(base, additions) {
    const merged = getDefaultDynamicFieldOptions();
    Object.keys(merged).forEach((key) => {
        merged[key] = normalizeUniqueValues([...(base[key] || []), ...(additions[key] || [])]);
    });
    return merged;
}

function createEmptyDynamicBucket() {
    return getDefaultDynamicFieldOptions();
}

function collectDynamicFieldValues(formData) {
    const collected = createEmptyDynamicBucket();

    if (formData?.experimentSiteSelection === 'other') {
        collected.experimentSiteOther.push(formData.experimentSiteOther || '');
    }

    const crop = formData?.cropDetails?.data || {};
    collected.cropType.push(crop.cropType || '');
    collected.variety.push(crop.variety || '');
    collected.nursery.push(crop.nursery || '');

    const soil = formData?.soilDetails?.data || {};
    collected.substrateCompany.push(soil.substrateCompany || '');
    collected.substrateType.push(soil.substrateType || '');
    (soil.disinfectRows || []).forEach((row) => {
        collected.soilDisinfectionMaterial.push(row?.material || '');
    });

    (formData?.fertilizationData || []).forEach((row) => {
        collected.fertilizerType.push(row?.fertType || '');
        collected.fertilizerCompany.push(row?.company || '');
    });

    const plantProtection = formData?.plantProtectionData || {};
    [...(plantProtection.sprays || []), ...(plantProtection.drenches || [])].forEach((row) => {
        collected.plantProtectionMaterial.push(row?.material || '');
    });

    Object.keys(collected).forEach((key) => {
        collected[key] = normalizeUniqueValues(collected[key]);
    });

    return collected;
}

async function loadDynamicFieldOptions() {
    if (!experimentOwnerUid) return;

    try {
        const optionsRef = doc(db, 'users', experimentOwnerUid, 'settings', 'experimentDynamicOptions');
        const optionsSnap = await getDoc(optionsRef);
        const base = getDefaultDynamicFieldOptions();

        if (optionsSnap.exists()) {
            const data = optionsSnap.data() || {};
            Object.keys(base).forEach((key) => {
                base[key] = normalizeUniqueValues(data[key]);
            });
        }

        dynamicFieldOptions = base;
        applyDynamicFieldOptionsToUI();
    } catch (error) {
        if (error?.code === 'permission-denied') {
            dynamicFieldOptions = getDefaultDynamicFieldOptions();
            applyDynamicFieldOptionsToUI();
            console.warn('Skipping dynamic field options load due to permissions (permission-denied).');
            return;
        }
        console.error('Error loading dynamic field options:', error);
    }
}

async function persistDynamicFieldOptions(formData) {
    if (!experimentOwnerUid) return;

    try {
        const additions = collectDynamicFieldValues(formData);
        const merged = mergeDynamicFieldOptions(dynamicFieldOptions, additions);
        const optionsRef = doc(db, 'users', experimentOwnerUid, 'settings', 'experimentDynamicOptions');

        await setDoc(optionsRef, merged, { merge: true });
        dynamicFieldOptions = merged;
        applyDynamicFieldOptionsToUI();
    } catch (error) {
        if (error?.code === 'permission-denied') {
            console.warn('Skipping dynamic field options persist due to permissions (permission-denied).');
            return;
        }
        console.error('Error persisting dynamic field options:', error);
    }
}

// =========================================
// Initialization
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
});

window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        window.location.reload();
    }
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    currentUser = user;

    // בדיקת אישור משתמש לפני טעינת הניסוי
    const isApproved = await checkUserApproval();
    if (!isApproved) {
        return; // checkUserApproval מטפל בהודעה ובניתוב
    }

    // אתחול זמן שרת
    await initServerTime(db, currentUser);

    await loadUserData();

    // טען את כל המשתמשים מוקדם - נדרש לסנכרון שותפים!
    await loadAllUsers();

    // Ensure year dropdown is initialized before loading experiment data so
    // populateForm can set the select value into existing options.
    initYearsDropdown();

    // Get experiment ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    currentExperimentId = urlParams.get('id');
    const section = urlParams.get('section');
    const ownerParam = urlParams.get('owner'); // לניסויים משותפים

    // קבע את הבעלים של הניסוי
    if (ownerParam) {
        experimentOwnerUid = ownerParam;
        isSharedExperiment = true;
    } else {
        experimentOwnerUid = currentUser.uid;
        isSharedExperiment = false;
    }

    if (currentExperimentId && experimentOwnerUid) {
        try {
            localStorage.setItem(
                'research-map-active-experiment-context',
                JSON.stringify({ experimentId: currentExperimentId, ownerUid: experimentOwnerUid })
            );
        } catch (error) {
            console.warn('Could not persist research map experiment context', error);
        }
    }

    await loadDynamicFieldOptions();

    if (currentExperimentId) {
        isNavigationStateReady = false;
        await loadExperiment();
        restoreNavigationState(section);
        isNavigationStateReady = true;
        persistNavigationState(true);
    } else {
        window.location.href = "dashboard.html";
    }
});

// בדיקה אם המשתמש מאושר
async function checkUserApproval() {
    try {
        const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            if (userData.isApproved === true) {
                return true;
            } else {
                // משתמש לא מאושר - התנתק והחזר לדף התחברות
                await signOut(auth);
                window.location.href = "login.html";
                return false;
            }
        } else {
            // אין מסמך משתמש
            await signOut(auth);
            window.location.href = "login.html";
            return false;
        }
    } catch (error) {
        console.error("Error checking user approval:", error);
        return false;
    }
}

// Load user data
async function loadUserData() {
    try {
        const docSnap = await getDoc(doc(db, "users", currentUser.uid));
        if (docSnap.exists()) {
            userData = docSnap.data();
            const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim();
            const userDisplay = document.getElementById('user-display-name');
            if (userDisplay) {
                userDisplay.textContent = fullName || currentUser.email || 'משתמש';
            }

            // בדיקת הרשאות ניהול על ידי ניסיון גישה לנתונים מוגבלים
            await checkAndDisplayAdminMenu();
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
    }
}

// בדיקת הרשאות ניהול והצגת תפריט
async function checkAndDisplayAdminMenu() {
    try {
        const usersQuery = query(collection(db, "users"), limit(2));
        const snapshot = await getDocs(usersQuery);
        if (snapshot.size > 1) {
            displayAdminMenuInExperiment();
        }
    } catch (error) {
        // אין הרשאות ניהול - לא מציגים תפריט
    }
}

// הצגת תפריט ניהול לאדמין בסיידבר של דף הניסוי
function displayAdminMenuInExperiment() {
    const sidebar = document.querySelector('.sidebar-nav');
    if (!sidebar) return;

    // בדוק אם התפריט כבר קיים
    if (document.querySelector('.admin-menu-section')) return;

    const adminMenuHTML = `
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
    `;

    sidebar.insertAdjacentHTML('beforeend', adminMenuHTML);
}

// Load all users for partner selection
// Reads from publicUsers collection which contains ONLY public fields
// This provides database-level security - sensitive data is never exposed
async function loadAllUsers() {
    try {
        // Use publicUsers collection instead of users for better security
        // publicUsers contains ONLY: uid, firstName, lastName, email, role
        // Does NOT contain: phone, createdAt, or any other sensitive data
        const usersRef = collection(db, "publicUsers");
        const querySnapshot = await getDocs(usersRef);

        allUsers = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            // All fields in publicUsers are safe to use
            allUsers.push({
                uid: docSnap.id,
                firstName: data.firstName || '',
                lastName: data.lastName || '',
                email: data.email || '',
                role: data.role || '',
                fullName: `${data.firstName || ''} ${data.lastName || ''}`.trim()
            });
        });
    } catch (error) {
        console.error("Error loading users:", error);

        // Check if it's a permission error
        if (error.code === 'permission-denied') {
            showToast('שגיאת הרשאות - לא ניתן לטעון רשימת משתמשים.', 'error', 5000);
        } else {
            showToast('שגיאה בטעינת רשימת משתמשים', 'error');
        }

        allUsers = []; // Empty array so the UI doesn't break
    }
}

// Initialize years dropdown
function initYearsDropdown() {
    const yearSelect = document.getElementById('experiment-year');
    if (!yearSelect) return;

    const currentYear = new Date().getFullYear();
    yearSelect.innerHTML = '<option value="">בחר שנה</option>';


    for (let year = currentYear - 5; year <= currentYear + 5; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}

// =========================================
// Load Experiment
// =========================================
async function loadExperiment() {
    const loadingContainer = document.getElementById('loading-container');
    const experimentContent = document.getElementById('experiment-content');

    // הצג את הספינר והסתר את התוכן
    if (loadingContainer) loadingContainer.classList.remove('hidden');
    if (experimentContent) experimentContent.style.display = 'none';

    try {
        // טען מהבעלים של הניסוי (יכול להיות המשתמש הנוכחי או אחר אם זה ניסוי משותף)
        const experimentRef = doc(db, "users", experimentOwnerUid, "experiments", currentExperimentId);
        const experimentSnap = await getDoc(experimentRef);

        if (experimentSnap.exists()) {
            experimentData = experimentSnap.data();
            populateForm();
            updateUI();
            generateTreatmentTabs();
            // אתחל את ה-autocomplete של השותפים אחרי שהניסוי נטען
            initPartnersAutocomplete();
            // אתחל שותפים לניסוי (multi-select)
            initLeadResearcherAutocomplete();
            initExperimentPartnersAutocomplete();
            // הגבלת תאריך תפוגה לניסוי פרטי
            enforcePrivateUntilDateMax();
            // אתחל את יומן האירועים
            initEventsLog();
            // אתחל את ניתוחים פיננסים
            initFinancialLog();
            setLastSavedFormSignatureFromCurrent();
                // Calculate permissions state for the loaded experiment
                try {
                    const trustedNow = getTrustedNow();
                    permissionsState = {
                        canRead: canRead(experimentData, currentUser, userData, trustedNow, experimentOwnerUid),
                        canEdit: canEdit(experimentData, currentUser, userData, trustedNow, experimentOwnerUid),
                        canManage: canManage(experimentData, currentUser, userData, experimentOwnerUid),
                        role: getRole(experimentData, currentUser, userData, experimentOwnerUid)
                    };
                } catch (err) {
                    console.warn('Could not evaluate permissions state', err);
                    permissionsState = { canRead: false, canEdit: false, canManage: false, role: 'none' };
                }

                // Apply permissions to UI
                try { applyPermissions(); } catch (e) { console.warn('applyPermissions failed', e); }
        } else {
            showToast('הניסוי לא נמצא', 'error');
            window.location.href = "dashboard.html";
        }
    } catch (error) {
        console.error("Error loading experiment:", error);

        // בדיקה אם זו שגיאת הרשאות
        if (error.code === 'permission-denied') {
            showAccessDeniedMessage();
        } else {
            showToast('שגיאה בטעינת הניסוי', 'error');
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 2000);
        }
    } finally {
        // הסתר את הספינר והצג את התוכן
        if (loadingContainer) loadingContainer.classList.add('hidden');
        if (experimentContent) experimentContent.style.display = 'block';
    }
}

// הצגת הודעת "אין גישה" עם הסבר
function showAccessDeniedMessage() {
    const experimentContent = document.getElementById('experiment-content');
    if (!experimentContent) return;

    experimentContent.innerHTML = `
        <div class="access-denied-container">
            <div class="access-denied-icon">
                <i class="fas fa-lock"></i>
            </div>
            <h2>אין לך הרשאה לצפות בניסוי זה</h2>
            <p class="access-denied-text">
                הניסוי הזה לא שותף איתך. כדי לקבל גישה, בקש מבעל הניסוי לשתף אותו איתך.
            </p>
            <div class="access-denied-steps">
                <h3>איך לקבל גישה?</h3>
                <ol>
                    <li>פנה לבעל הניסוי ובקש ממנו לשתף אותך</li>
                    <li>בעל הניסוי צריך להיכנס לניסוי שלו</li>
                    <li>בחלק "שותפים" - להוסיף אותך כשותף</li>
                    <li>לאחר מכן תוכל לגשת לניסוי מהדשבורד שלך</li>
                </ol>
            </div>
            <button class="btn-back-home" onclick="window.location.href='dashboard.html'">
                <i class="fas fa-home"></i>
                חזרה לדשבורד
            </button>
        </div>
    `;
}

// Update UI elements
function updateUI() {
    const name = experimentData.experimentName || 'ניסוי';

    const sidebarName = document.getElementById('sidebar-experiment-name');
    if (sidebarName) sidebarName.textContent = name;

    document.title = `${name} - מיזם ח"ץ`;

    // Update breadcrumb for current view
    switchView(currentView);
}

// =========================================
// Populate Form
// =========================================
function populateForm() {
    const data = experimentData;

    // Lead researcher
    const leadResearcher = document.getElementById('lead-researcher');
    if (leadResearcher) {
        if (data.leadResearcher) {
            leadResearcher.value = data.leadResearcher;
        } else if (userData) {
            leadResearcher.value = `${userData.firstName || ''} ${userData.lastName || ''}`.trim();
        }
    }

    // Partners
    if (data.partners && data.partners.length > 0) {
        const container = document.getElementById('partners-container');
        if (container) {
            container.innerHTML = '';
            data.partners.forEach(partner => addPartnerRow(partner));
        }
    }

    // Experiment Partners (multi-select chips)
    populateExperimentPartners(data.experimentPartners || []);

    // Creator field
    populateCreatorField(data);

    // Basic fields
    setFieldValue('experiment-year', data.experimentYear);
    setFieldValue('experiment-month', data.experimentMonth);
    setFieldValue('research-period', data.researchPeriod || data.startDate || '');
    setFieldValue('study-type', STUDY_TYPES.includes(data.studyType) ? data.studyType : 'field');
    setFieldValue('work-package', data.workPackage);
    setExperimentSiteFromData(data.experimentSite, data.experimentSiteSelection, data.experimentSiteOther);
    setFieldValue('site-coordinates', data.siteCoordinates);
    setFieldValue('lab-cell-number', data.labCellNumber);
    setFieldValue('experiment-goal', data.experimentGoal);
    setFieldValue('experiment-summary', data.experimentSummary);

    // תוספת חשיפה
    setFieldValue('experiment-visibility', data.visibility || 'public');
    if (data.privateUntil && data.privateUntil.toDate) {
        const dateObj = data.privateUntil.toDate();
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        setFieldValue('private-until-date', `${yyyy}-${mm}-${dd}`);
    } else {
        setFieldValue('private-until-date', '');
    }
    setFieldValue('treatments-count', data.treatmentsCount || 3);
    setFieldValue('repetitions-count', data.repetitionsCount);
    setFieldValue('levels-count', data.levelsCount);
    setFieldValue('level-value', data.levelValue);

    // Treatments
    generateTreatmentInputs(data.treatmentsCount || 3, data.treatments || [], data.repetitionsCount);

    // Variables
    if (data.independentVariables) {
        data.independentVariables.forEach(v => addVariableRow('independent', v));
    }
    if (data.dependentVariables) {
        data.dependentVariables.forEach(v => addVariableRow('dependent', v));
    }

    // Keywords
    if (data.keywords) {
        data.keywords.forEach(k => addKeywordTag(k));
    }

    // Crop details
    if (data.cropDetails && data.cropDetails.data) {
        const crop = data.cropDetails.data;
        let mappedVarietyType = crop.varietyType || '';
        if (mappedVarietyType === 'cherry' || mappedVarietyType === 'cluster') {
            mappedVarietyType = 'regular';
        }
        let mappedSplitPlant = crop.splitPlant || '';
        if (mappedSplitPlant === 'yes') mappedSplitPlant = 'כן';
        if (mappedSplitPlant === 'no') mappedSplitPlant = 'לא';

        setFieldValue('planting-date', crop.plantingDate);
        setFieldValue('inoculation-date-1', crop.inoculationDate1);
        setFieldValue('inoculation-date-2', crop.inoculationDate2);
        setFieldValue('crop-type', crop.cropType);
        setFieldValue('variety', crop.variety);
        setFieldValue('grafted-plant', crop.graftedPlant);
        setFieldValue('variety-type', mappedVarietyType);
        setFieldValue('split-plant', mappedSplitPlant);
        setFieldValue('nursery', crop.nursery);
        setFieldValue('seedlings-count', crop.seedlingsCount);
        setFieldValue('planting-density', crop.plantingDensity);
        setFieldValue('pots-count', crop.potsCount);
        setFieldValue('seedlings-per-pot', crop.seedlingsPerPot);
        setFieldValue('planting-structure', crop.plantingStructure);
        setFieldValue('experiment-area', crop.experimentArea);
        setFieldValue('preparation-name', crop.preparationName);
        setFieldValue('crop-notes', crop.notes);

    }

    // Structure details
    if (data.structureDetails && data.structureDetails.data) {
        const structure = data.structureDetails.data;
        setFieldValue('structure-type', structure.type);
        setFieldValue('structure-size', structure.size);
        setFieldValue('roof-covering', structure.roofCovering);
        setFieldValue('cell-temp-mode', structure.cellTempMode);
        setFieldValue('cell-temp-fixed', structure.cellTempFixed);
        setFieldValue('cell-temp-min-night', structure.cellTempMinNight);
        setFieldValue('cell-temp-max-day', structure.cellTempMaxDay);
        setFieldValue('structure-direction', structure.direction);
        setFieldValue('structure-notes', structure.notes);
    }

    // Soil details
    if (data.soilDetails && data.soilDetails.data) {
        const soil = data.soilDetails.data;
        setFieldValue('detached-substrate', soil.detachedSubstrate);
        setFieldValue('substrate-company', soil.substrateCompany);
        setFieldValue('substrate-type', soil.substrateType);
        setFieldValue('substrate-volume', soil.substrateVolume);
        setFieldValue('soil-disinfection-adigan', soil.disinfectionAdigan);
        setAdiganAmountFromData(soil.adiganAmount);
        // Dynamic tables
        renderSoilTable('compost-tbody', soil.compostRows || [], ['date','amount','method']);
        renderSoilDisinfectTable('disinfect-tbody', soil.disinfectRows || []);
    }

    // Drip details
    if (data.dripDetails && data.dripDetails.data) {
        const drip = data.dripDetails.data;
        setFieldValue('drip-single-double', drip.singleDouble);
        setFieldValue('drip-pipe-diameter', drip.pipeDiameter);
        setFieldValue('drip-emitter-spacing', drip.emitterSpacing);
        setFieldValue('drip-flow-rate', drip.flowRate);
        setFieldValue('drip-type', drip.type);
        setFieldValue('drip-irrigation-duration-minutes', drip.irrigationDurationMinutes);
        setFieldValue('drip-irrigations-per-day', drip.irrigationsPerDay);
        setFieldValue('drip-lines-count', drip.linesCount);
        renderDripIrrigationTimes(drip.irrigationTimes || []);
    }

    // Progress views (מהלך הניסוי + נתוני יבול)
    populateProgressViews(data);

    updateConditionalFieldVisibility();

    // עדכון כפתור Google Maps אחרי שהנתונים נטענו
    updateGoogleMapsButtonVisibility();

    initializeSharedSectionState();
    syncSharedToggleForCurrentView();
    loadCurrentSectionDataFromState();
}

function setExperimentSiteFromData(experimentSiteValue, experimentSiteSelection, experimentSiteOther) {
    const siteSelect = document.getElementById('experiment-site');
    const siteOtherInput = document.getElementById('experiment-site-other');
    if (!siteSelect) return;

    const oldToNewSiteMap = {
        volcani: 'volcani-bet-dagan'
    };

    let normalizedSite = normalizeDynamicValue(experimentSiteValue);
    normalizedSite = oldToNewSiteMap[normalizedSite] || normalizedSite;

    let selection = normalizeDynamicValue(experimentSiteSelection);
    if (!selection) {
        selection = SITE_PRESET_VALUES.includes(normalizedSite) ? normalizedSite : (normalizedSite ? 'other' : '');
    }

    siteSelect.value = selection;

    if (siteOtherInput) {
        const resolvedOther = normalizeDynamicValue(experimentSiteOther) || (selection === 'other' ? normalizedSite : '');
        siteOtherInput.value = resolvedOther;
    }

    updateExperimentSiteOtherVisibility();
}

function setAdiganAmountFromData(value) {
    const adiganAmountSelect = document.getElementById('soil-adigan-amount');
    const adiganAmountCustomInput = document.getElementById('soil-adigan-amount-custom');
    if (!adiganAmountSelect || !adiganAmountCustomInput) return;

    const normalized = normalizeDynamicValue(value);
    const presetValues = ['40', '60', '80', '100', '120'];

    if (!normalized) {
        adiganAmountSelect.value = '';
        adiganAmountCustomInput.value = '';
    } else if (presetValues.includes(normalized)) {
        adiganAmountSelect.value = normalized;
        adiganAmountCustomInput.value = '';
    } else {
        adiganAmountSelect.value = 'other';
        adiganAmountCustomInput.value = normalized;
    }

    updateAdiganAmountVisibility();
}

function getResolvedAdiganAmount() {
    const adiganAmountSelect = document.getElementById('soil-adigan-amount');
    const adiganAmountCustomInput = document.getElementById('soil-adigan-amount-custom');
    if (!adiganAmountSelect || !adiganAmountCustomInput) return '';

    if (adiganAmountSelect.value === 'other') {
        return adiganAmountCustomInput.value.trim();
    }
    return adiganAmountSelect.value || '';
}

function setFieldValue(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) {
        el.value = value;
    }
}

function collectSectionDataFromDOM(sectionId) {
    switch (sectionId) {
        case 'crop':
            return {
                plantingDate: document.getElementById('planting-date')?.value || '',
                inoculationDate1: document.getElementById('inoculation-date-1')?.value || '',
                inoculationDate2: document.getElementById('inoculation-date-2')?.value || '',
                cropType: document.getElementById('crop-type')?.value || '',
                variety: document.getElementById('variety')?.value || '',
                graftedPlant: document.getElementById('grafted-plant')?.value || '',
                varietyType: document.getElementById('variety-type')?.value || '',
                splitPlant: document.getElementById('split-plant')?.value || '',
                nursery: document.getElementById('nursery')?.value || '',
                seedlingsCount: document.getElementById('seedlings-count')?.value || '',
                plantingDensity: document.getElementById('planting-density')?.value || '',
                potsCount: document.getElementById('pots-count')?.value || '',
                seedlingsPerPot: document.getElementById('seedlings-per-pot')?.value || '',
                plantingStructure: document.getElementById('planting-structure')?.value || '',
                experimentArea: document.getElementById('experiment-area')?.value || '',
                preparationName: document.getElementById('preparation-name')?.value || '',
                notes: document.getElementById('crop-notes')?.value || ''
            };
        case 'structure':
            return {
                type: document.getElementById('structure-type')?.value || '',
                size: document.getElementById('structure-size')?.value || '',
                roofCovering: document.getElementById('roof-covering')?.value || '',
                cellTempMode: document.getElementById('cell-temp-mode')?.value || '',
                cellTempFixed: document.getElementById('cell-temp-fixed')?.value || '',
                cellTempMinNight: document.getElementById('cell-temp-min-night')?.value || '',
                cellTempMaxDay: document.getElementById('cell-temp-max-day')?.value || '',
                direction: document.getElementById('structure-direction')?.value || '',
                notes: document.getElementById('structure-notes')?.value || ''
            };
        case 'soil':
            return {
                detachedSubstrate: document.getElementById('detached-substrate')?.value || '',
                substrateCompany: document.getElementById('substrate-company')?.value || '',
                substrateType: document.getElementById('substrate-type')?.value || '',
                substrateVolume: document.getElementById('substrate-volume')?.value || '',
                disinfectionAdigan: document.getElementById('soil-disinfection-adigan')?.value || '',
                adiganAmount: getResolvedAdiganAmount(),
                compostRows: collectSoilTableRows('compost-tbody', ['date','amount','method']),
                disinfectRows: collectSoilDisinfectRows('disinfect-tbody')
            };
        case 'drip':
            return {
                singleDouble: document.getElementById('drip-single-double')?.value || '',
                pipeDiameter: document.getElementById('drip-pipe-diameter')?.value || '',
                type: document.getElementById('drip-type')?.value || '',
                emitterSpacing: document.getElementById('drip-emitter-spacing')?.value || '',
                flowRate: document.getElementById('drip-flow-rate')?.value || '',
                irrigationDurationMinutes: document.getElementById('drip-irrigation-duration-minutes')?.value || '',
                irrigationsPerDay: document.getElementById('drip-irrigations-per-day')?.value || '',
                irrigationTimes: collectDripIrrigationTimes(),
                linesCount: document.getElementById('drip-lines-count')?.value || '',
            };
        case 'irrigation':
            return {
                irrigationData: collectProgressRows('irrigation-tbody', IRRIGATION_FIELDS),
                fertilizationData: collectProgressRows('fertilization-tbody', FERTILIZATION_FIELDS)
            };
        case 'growth':
            return {
                growthData: collectProgressRows('growth-tbody', GROWTH_FIELDS)
            };
        case 'climate':
            return {
                climateData: collectProgressRows('climate-tbody', CLIMATE_FIELDS)
            };
        case 'agrotechnics':
            return {
                agrotechnicsData: collectProgressRows('agro-tbody', AGRO_FIELDS)
            };
        case 'plantProtection':
            return {
                plantProtectionData: {
                    pests: collectProgressRows('pest-tbody', PEST_FIELDS),
                    diseases: collectProgressRows('disease-tbody', PEST_FIELDS),
                    sprays: collectProgressRows('spray-prot-tbody', PROTECTION_FIELDS),
                    drenches: collectProgressRows('drench-tbody', PROTECTION_FIELDS)
                }
            };
        case 'yield':
            return {
                yieldData: {
                    measures: collectProgressRows('yield-measure-tbody', YIELD_MEASURE_FIELDS),
                    damages: collectProgressRows('yield-damage-tbody', YIELD_DAMAGE_FIELDS)
                }
            };
        default:
            return {};
    }
}

function applySectionDataToDOM(sectionId, sectionData) {
    const data = sectionData || {};

    switch (sectionId) {
        case 'crop': {
            let mappedVarietyType = data.varietyType || '';
            if (mappedVarietyType === 'cherry' || mappedVarietyType === 'cluster') mappedVarietyType = 'regular';
            let mappedSplitPlant = data.splitPlant || '';
            if (mappedSplitPlant === 'yes') mappedSplitPlant = 'כן';
            if (mappedSplitPlant === 'no') mappedSplitPlant = 'לא';

            setFieldValue('planting-date', data.plantingDate);
            setFieldValue('inoculation-date-1', data.inoculationDate1);
            setFieldValue('inoculation-date-2', data.inoculationDate2);
            setFieldValue('crop-type', data.cropType);
            setFieldValue('variety', data.variety);
            setFieldValue('grafted-plant', data.graftedPlant);
            setFieldValue('variety-type', mappedVarietyType);
            setFieldValue('split-plant', mappedSplitPlant);
            setFieldValue('nursery', data.nursery);
            setFieldValue('seedlings-count', data.seedlingsCount);
            setFieldValue('planting-density', data.plantingDensity);
            setFieldValue('pots-count', data.potsCount);
            setFieldValue('seedlings-per-pot', data.seedlingsPerPot);
            setFieldValue('planting-structure', data.plantingStructure);
            setFieldValue('experiment-area', data.experimentArea);
            setFieldValue('preparation-name', data.preparationName);
            setFieldValue('crop-notes', data.notes);
            break;
        }
        case 'structure': {
            setFieldValue('structure-type', data.type);
            setFieldValue('structure-size', data.size);
            setFieldValue('roof-covering', data.roofCovering);
            setFieldValue('cell-temp-mode', data.cellTempMode);
            setFieldValue('cell-temp-fixed', data.cellTempFixed);
            setFieldValue('cell-temp-min-night', data.cellTempMinNight);
            setFieldValue('cell-temp-max-day', data.cellTempMaxDay);
            setFieldValue('structure-direction', data.direction);
            setFieldValue('structure-notes', data.notes);
            break;
        }
        case 'soil': {
            setFieldValue('detached-substrate', data.detachedSubstrate);
            setFieldValue('substrate-company', data.substrateCompany);
            setFieldValue('substrate-type', data.substrateType);
            setFieldValue('substrate-volume', data.substrateVolume);
            setFieldValue('soil-disinfection-adigan', data.disinfectionAdigan);
            setAdiganAmountFromData(data.adiganAmount);
            renderSoilTable('compost-tbody', data.compostRows || [], ['date','amount','method']);
            renderSoilDisinfectTable('disinfect-tbody', data.disinfectRows || []);
            break;
        }
        case 'drip': {
            setFieldValue('drip-single-double', data.singleDouble);
            setFieldValue('drip-pipe-diameter', data.pipeDiameter);
            setFieldValue('drip-type', data.type);
            setFieldValue('drip-emitter-spacing', data.emitterSpacing);
            setFieldValue('drip-flow-rate', data.flowRate);
            setFieldValue('drip-irrigation-duration-minutes', data.irrigationDurationMinutes);
            setFieldValue('drip-irrigations-per-day', data.irrigationsPerDay);
            setFieldValue('drip-lines-count', data.linesCount);
            renderDripIrrigationTimes(data.irrigationTimes || []);
            break;
        }
        case 'irrigation': {
            const irrigTbody = document.getElementById('irrigation-tbody');
            if (irrigTbody) {
                irrigTbody.innerHTML = '';
                (data.irrigationData || []).forEach((row) => addProgressRow(irrigTbody, IRRIGATION_FIELDS, IRRIGATION_LABELS, normalizeLegacyRangeDates(row)));
            }

            const fertTbody = document.getElementById('fertilization-tbody');
            if (fertTbody) {
                fertTbody.innerHTML = '';
                (data.fertilizationData || []).forEach((row) => addProgressRow(fertTbody, FERTILIZATION_FIELDS, FERTILIZATION_LABELS, normalizeLegacyRangeDates(row), {
                    dynamicDatalists: FERTILIZATION_DYNAMIC_DATALISTS
                }));
            }
            break;
        }
        case 'growth': {
            renderGrowthTable(data.growthData || []);
            break;
        }
        case 'climate': {
            renderClimateTable(data.climateData || []);
            break;
        }
        case 'agrotechnics': {
            renderAgroTable(data.agrotechnicsData || []);
            break;
        }
        case 'plantProtection': {
            const pp = data.plantProtectionData || {};

            const pestTbody = document.getElementById('pest-tbody');
            if (pestTbody) {
                pestTbody.innerHTML = '';
                (pp.pests || []).forEach((row) => addPestRow('pest-tbody', row));
            }

            const diseaseTbody = document.getElementById('disease-tbody');
            if (diseaseTbody) {
                diseaseTbody.innerHTML = '';
                (pp.diseases || []).forEach((row) => addPestRow('disease-tbody', row));
            }

            const sprayProtTbody = document.getElementById('spray-prot-tbody');
            if (sprayProtTbody) {
                sprayProtTbody.innerHTML = '';
                (pp.sprays || []).forEach((row) => addProtectionRow('spray-prot-tbody', row));
            }

            const drenchTbody = document.getElementById('drench-tbody');
            if (drenchTbody) {
                drenchTbody.innerHTML = '';
                (pp.drenches || []).forEach((row) => addProtectionRow('drench-tbody', row));
            }
            break;
        }
        case 'yield': {
            const yd = data.yieldData || {};

            const ymTbody = document.getElementById('yield-measure-tbody');
            if (ymTbody) {
                ymTbody.innerHTML = '';
                (yd.measures || []).forEach((row) => addYieldMeasureRow(row));
            }

            const ydTbody = document.getElementById('yield-damage-tbody');
            if (ydTbody) {
                ydTbody.innerHTML = '';
                (yd.damages || []).forEach((row) => addYieldDamageRow(row));
            }
            break;
        }
        default:
            break;
    }

    updateConditionalFieldVisibility();
}

function syncSharedToggleForCurrentView() {
    const toggle = document.getElementById('shared-data-toggle');
    const sectionId = getSectionIdByView();
    if (!toggle || !sectionId) return;

    const model = getSectionModel(sectionId);
    isSyncingSharedToggle = true;
    toggle.checked = model?.shared !== false;
    isSyncingSharedToggle = false;
}

function getSharedReadonlyMessageElement() {
    const toggleContainer = document.getElementById('shared-toggle-container');
    if (!toggleContainer) return null;

    let messageEl = document.getElementById('shared-readonly-message');
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'shared-readonly-message';
        messageEl.style.width = '100%';
        messageEl.style.marginTop = '8px';
        messageEl.style.fontSize = '0.9rem';
        messageEl.style.fontWeight = '600';
        messageEl.style.color = '#666';
        messageEl.style.display = 'none';
        toggleContainer.appendChild(messageEl);
    }

    return messageEl;
}

function applySharedReadonlyForCurrentView() {
    const sectionId = getSectionIdByView();
    const viewElement = document.getElementById(`view-${currentView}`);
    const messageEl = getSharedReadonlyMessageElement();

    if (!sectionId || !viewElement) {
        if (messageEl) messageEl.style.display = 'none';
        return;
    }

    const model = getSectionModel(sectionId);
    const isReadOnlyMode = Boolean(model?.shared && currentTreatmentIndex > 0);
    const controls = viewElement.querySelectorAll('input, select, textarea, button');

    controls.forEach((control) => {
        if (control.type === 'hidden') return;

        if (isReadOnlyMode) {
            if (!control.dataset.sharedReadonlyManaged) {
                control.dataset.sharedReadonlyManaged = '1';
                control.dataset.sharedReadonlyPrevDisabled = control.disabled ? '1' : '0';
            }
            control.disabled = true;
        } else if (control.dataset.sharedReadonlyManaged === '1') {
            control.disabled = control.dataset.sharedReadonlyPrevDisabled === '1';
            delete control.dataset.sharedReadonlyManaged;
            delete control.dataset.sharedReadonlyPrevDisabled;
        }
    });

    if (messageEl) {
        if (isReadOnlyMode) {
            messageEl.textContent = 'נתונים זהים לכלל הטיפולים. אם ברצונך לשנות, בטל/י את הסימון "נתונים זהים לכלל הטיפולים".';
            messageEl.style.display = 'block';
        } else {
            messageEl.style.display = 'none';
        }
    }
}


function persistCurrentSectionDataToState() {
    const sectionId = getSectionIdByView();
    if (!sectionId) return;
    const sectionData = collectSectionDataFromDOM(sectionId);
    setSectionCurrentData(sectionId, sectionData);
}

function loadCurrentSectionDataFromState() {
    const sectionId = getSectionIdByView();
    if (!sectionId) return;
    const sectionData = getSectionEffectiveData(sectionId);
    applySectionDataToDOM(sectionId, sectionData);
    applySharedReadonlyForCurrentView();
}

function setSectionSharedState(sectionId, shouldBeShared) {
    const model = getSectionModel(sectionId);
    if (!model) return;

    if (shouldBeShared === model.shared) return;

    if (shouldBeShared) {
        cloneSectionTreatment1ToAll(sectionId);
        model.shared = true;
        return;
    }

    cloneSectionTreatment1ToAll(sectionId);
    model.shared = false;
}

function buildSectionModelForSave(sectionId) {
    const model = getSectionModel(sectionId);
    if (!model) {
        return { shared: true, sharedData: {}, byTreatment: [], data: {} };
    }

    ensureModelTreatmentLength(model);

    const treatmentOneData = deepClone(model.byTreatment[0] || model.sharedData || {});
    return {
        shared: model.shared !== false,
        data: treatmentOneData,
        sharedData: deepClone(model.sharedData || {}),
        byTreatment: deepClone(model.byTreatment || [])
    };
}

function getSectionValidationEntries(sectionDetails) {
    const entries = [];
    if (!sectionDetails) return entries;

    const byTreatment = Array.isArray(sectionDetails.byTreatment)
        ? sectionDetails.byTreatment.filter(Boolean)
        : [];

    if (sectionDetails.shared === false) {
        entries.push(...byTreatment);
    } else {
        const sharedData = sectionDetails.sharedData && Object.keys(sectionDetails.sharedData).length
            ? sectionDetails.sharedData
            : sectionDetails.data;
        if (sharedData) entries.push(sharedData);
    }

    if (entries.length === 0 && sectionDetails.data) {
        entries.push(sectionDetails.data);
    }

    return entries;
}

function hasFilePathInValue(value, targetFilePath) {
    if (!value || !targetFilePath) return false;

    if (Array.isArray(value)) {
        return value.some((item) => hasFilePathInValue(item, targetFilePath));
    }

    if (typeof value === 'object') {
        if (value.filePath === targetFilePath) return true;
        return Object.values(value).some((child) => hasFilePathInValue(child, targetFilePath));
    }

    return false;
}

function isFilePathSharedAcrossTreatments(sectionId, filePath, currentIndex = currentTreatmentIndex) {
    const model = getSectionModel(sectionId);
    if (!model || !filePath) return false;

    ensureModelTreatmentLength(model);

    return model.byTreatment.some((entry, idx) => idx !== currentIndex && hasFilePathInValue(entry, filePath));
}

// עדכון כפתור Google Maps - פונקציה גלובלית שניתן לקרוא לה מכל מקום
function updateGoogleMapsButtonVisibility() {
    const openGoogleMapsBtn = document.getElementById('open-google-maps-btn');
    const coordsInput = document.getElementById('site-coordinates');
    const isLab = getCurrentStudyType() === 'lab';

    if (openGoogleMapsBtn && coordsInput) {
        if (isLab) {
            openGoogleMapsBtn.style.display = 'none';
        } else if (coordsInput.value && coordsInput.value.trim()) {
            openGoogleMapsBtn.style.display = 'block';
        } else {
            openGoogleMapsBtn.style.display = 'none';
        }
    }
}

// =========================================
// Treatment Tabs
// =========================================
function generateTreatmentTabs() {
    const count = parseInt(document.getElementById('treatments-count')?.value) || 0;
    const treatments = experimentData?.treatments || [];
    const tabsNav = document.getElementById('tabs-nav');

    if (!tabsNav) return;

    tabsNav.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'tab-item' + (i === currentTreatmentIndex ? ' active' : '');

        const treatmentName = treatments[i]?.name || `טיפול ${i + 1}`;
        tab.textContent = treatmentName;
        tab.dataset.index = i;

        tab.addEventListener('click', () => switchTreatmentTab(i));
        // Insert at the beginning to reverse the order (1,2,3 from right to left)
        tabsNav.insertBefore(tab, tabsNav.firstChild);
    }
}

function switchTreatmentTab(index) {
    persistCurrentSectionDataToState();

    currentTreatmentIndex = index;
    // Match tabs by their data-index attribute instead of DOM order
    document.querySelectorAll('.tab-item').forEach((tab) => {
        const tabIndex = parseInt(tab.dataset.index);
        tab.classList.toggle('active', tabIndex === index);
    });

    loadCurrentSectionDataFromState();
    persistNavigationState();
}

// =========================================
// View Switching
// =========================================
function switchView(viewName) {
    const previousView = currentView;
    if (previousView !== viewName) {
        persistCurrentSectionDataToState();
    }

    currentView = viewName;

    // Hide all views
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    // Show selected view
    const viewElement = document.getElementById(`view-${viewName}`);
    if (viewElement) {
        viewElement.classList.add('active');
    }

    // Update sidebar active states
    document.querySelectorAll('.sub-sub-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });
    document.querySelectorAll('.sub-item[data-view]').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Show/hide tabs and toggle
    const tabsContainer = document.getElementById('treatments-tabs');
    const toggleContainer = document.getElementById('shared-toggle-container');
    const viewsWithTabs = ['crop', 'structure', 'soil', 'drip', 'irrigation', 'growth', 'climate', 'agrotechnics', 'plant-protection', 'yield'];

    if (viewsWithTabs.includes(viewName)) {
        if (tabsContainer) tabsContainer.style.display = 'block';
        if (toggleContainer) toggleContainer.style.display = 'flex';
    } else {
        if (tabsContainer) tabsContainer.style.display = 'none';
        if (toggleContainer) toggleContainer.style.display = 'none';
        const messageEl = document.getElementById('shared-readonly-message');
        if (messageEl) messageEl.style.display = 'none';
    }

    syncSharedToggleForCurrentView();
    loadCurrentSectionDataFromState();

    // Update breadcrumb with full path and clickable links
    const viewNames = {
        'basic': 'תוכנית הניסוי',
        'crop': 'פרטי הגידול',
        'structure': 'דרישות המבנה',
        'soil': 'טיפול בקרקע',
        'drip': 'סוג ופריסת הטפטוף',
        'irrigation': 'השקיה ודשן',
        'growth': 'צימוח',
        'climate': 'נתוני אקלים וסנסורים',
        'agrotechnics': 'אגרוטכניקה',
        'plant-protection': 'הגנת הצומח',
        'yield': 'נתוני יבול',
        'events': 'יומן אירועים',
        'financial-analysis': 'ניתוחים פיננסים'
    };

    // Views that belong to "הכנות לניסוי"
    const prepViews = ['crop', 'structure', 'soil', 'drip'];
    // Views that belong to "מהלך הניסוי"
    const progressViews = ['irrigation', 'growth', 'climate', 'agrotechnics', 'plant-protection'];

    const expName = experimentData?.experimentName || 'ניסוי';
    const breadcrumb = document.getElementById('breadcrumb-text');

    if (breadcrumb) {
        let breadcrumbHTML = `<span class="breadcrumb-link" onclick="window.location.href='dashboard.html'">${expName}</span>`;

        if (prepViews.includes(viewName)) {
            // Add "הכנות לניסוי" for sub-categories
            breadcrumbHTML += ` > <span class="breadcrumb-text">הכנות לניסוי</span>`;
        } else if (progressViews.includes(viewName)) {
            // Add "מהלך הניסוי" for progress sub-categories
            breadcrumbHTML += ` > <span class="breadcrumb-text">מהלך הניסוי</span>`;
        }

        breadcrumbHTML += ` > <span class="breadcrumb-current">${viewNames[viewName] || viewName}</span>`;
        breadcrumb.innerHTML = breadcrumbHTML;
    }

    persistNavigationState();
}

// =========================================
// Dynamic Elements
// =========================================
function generateTreatmentInputs(count, existingTreatments = [], repetitionsCount = getCurrentRepetitionsCount()) {
    const container = document.getElementById('treatments-container');
    if (!container) return;

    const safeCount = Math.max(1, parseInt(count) || 0);
    const safeRepetitionsCount = Math.min(MAX_REPETITIONS_PER_TREATMENT, Math.max(1, parseInt(repetitionsCount) || 0));

    container.innerHTML = '';

    for (let i = 0; i < safeCount; i++) {
        const existing = existingTreatments[i] || {};
        const repeatLabels = getTreatmentRepeatLabels(existing, i, safeRepetitionsCount);
        const item = document.createElement('div');
        item.className = 'treatment-item';
        item.dataset.index = i;
        item.innerHTML = `
            <label>שם לטיפול ${i + 1}:</label>
            <input type="text" class="treatment-name" data-index="${i}" value="${existing.name || ''}" placeholder="שם הטיפול">
            <div class="treatment-repeats">
                ${repeatLabels.map((repeatLabel, repeatIndex) => `
                    <div class="treatment-repeat-row">
                        <label>חזרה ${repeatIndex + 1}:</label>
                        <input type="text" class="treatment-repeat" data-index="${i}" data-repeat-index="${repeatIndex}" value="${repeatLabel}" placeholder="חזרה ${repeatIndex + 1}">
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(item);
    }
}

function addPartnerRow(partnerData = null) {
    const container = document.getElementById('partners-container');
    if (!container) return;

    // Support both old string format and new object format
    let partnerName = '';
    let partnerEmail = '';

    if (typeof partnerData === 'string') {
        // Old format: just name
        partnerName = partnerData;
    } else if (partnerData && typeof partnerData === 'object') {
        // New format: {name, email}
        partnerName = partnerData.name || '';
        partnerEmail = partnerData.email || '';
    }

    const row = document.createElement('div');
    row.className = 'partner-row';
    row.dataset.email = partnerEmail; // Store email in data attribute

    // בדיקה אם המשתמש הנוכחי הוא הבעלים של הניסוי
    const isOwner = currentUser && experimentOwnerUid && currentUser.uid === experimentOwnerUid;
    const disabledClass = isOwner ? '' : 'disabled';
    const disabledAttr = isOwner ? '' : 'disabled';
    const disabledTitle = isOwner ? '' : 'title="רק מי שהקים את הניסוי יכול למחוק שותפים"';

    row.innerHTML = `
        <div class="partner-info">
            <div class="partner-name">${partnerName || 'לא צוין שם'}</div>
            <div class="partner-email">${partnerEmail || 'אין אימייל'}</div>
        </div>
        <button type="button" class="btn-icon btn-delete ${disabledClass}" ${disabledAttr} ${disabledTitle}><i class="fas fa-trash"></i></button>
    `;

    const deleteBtn = row.querySelector('.btn-delete');
    if (isOwner) {
        deleteBtn.addEventListener('click', async () => {
            if (!(await confirmDeferredDeletion('השותף'))) return;
            row.remove();
        });
    }
    container.appendChild(row);
}

function addVariableRow(type, value = '') {
    const containerId = type === 'independent' ? 'independent-vars-container' : 'dependent-vars-container';
    const container = document.getElementById(containerId);
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'variable-row';
    row.innerHTML = `
        <input type="text" class="${type}-var-input" value="${value}" placeholder="שם המשתנה">
        <button type="button" class="btn-icon btn-delete"><i class="fas fa-trash"></i></button>
    `;

    row.querySelector('.btn-delete').addEventListener('click', async () => {
        if (!(await confirmDeferredDeletion('המשתנה'))) return;
        row.remove();
    });
    container.appendChild(row);
}

function addKeywordTag(value) {
    const container = document.getElementById('keywords-list');
    if (!container) return;

    // Check if exists
    if (container.querySelector(`[data-value="${value}"]`)) return;

    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    tag.dataset.value = value;
    tag.innerHTML = `
        ${value}
        <span class="remove"><i class="fas fa-times"></i></span>
    `;

    tag.querySelector('.remove').addEventListener('click', async () => {
        if (!(await confirmDeferredDeletion('מילת המפתח'))) return;
        tag.remove();
    });
    container.appendChild(tag);
}

// =========================================
// Collect Form Data
// =========================================
function collectFormData() {
    // Partners - collect from partner rows
    const partners = [];
    document.querySelectorAll('.partner-row').forEach(row => {
        const nameEl = row.querySelector('.partner-name');
        const emailEl = row.querySelector('.partner-email');
        if (nameEl && nameEl.textContent && nameEl.textContent !== 'לא צוין שם') {
            partners.push({
                name: nameEl.textContent.trim(),
                email: row.dataset.email || emailEl?.textContent.trim() || ''
            });
        }
    });

    // Treatments
    const treatments = [];
    document.querySelectorAll('.treatment-item').forEach(item => {
        const index = parseInt(item.dataset.index);
        if (!Number.isFinite(index)) return;

        const nameInput = item.querySelector('.treatment-name');
        const repeatInputs = Array.from(item.querySelectorAll('.treatment-repeat'))
            .sort((a, b) => parseInt(a.dataset.repeatIndex) - parseInt(b.dataset.repeatIndex));
        const repeatLabels = repeatInputs.map((repeatInput, repeatIndex) => {
            const fallbackLabel = `חזרה ${repeatIndex + 1}`;
            return String(repeatInput?.value || '').trim() || fallbackLabel;
        });

        treatments.push({
            name: nameInput?.value || '',
            repeatLabels,
            repeatLabel: repeatLabels[0] || '',
            repeatNumber: repeatLabels.length || 1
        });
    });

    // Independent Variables
    const independentVariables = [];
    document.querySelectorAll('.independent-var-input').forEach(input => {
        if (input.value.trim()) independentVariables.push(input.value.trim());
    });

    // Dependent Variables
    const dependentVariables = [];
    document.querySelectorAll('.dependent-var-input').forEach(input => {
        if (input.value.trim()) dependentVariables.push(input.value.trim());
    });

    // Keywords
    const keywords = [];
    document.querySelectorAll('#keywords-list .keyword-tag').forEach(tag => {
        keywords.push(tag.dataset.value);
    });

    persistCurrentSectionDataToState();

    const cropModel = buildSectionModelForSave('crop');
    const structureModel = buildSectionModelForSave('structure');
    const soilModel = buildSectionModelForSave('soil');
    const dripModel = buildSectionModelForSave('drip');
    const irrigationModel = buildSectionModelForSave('irrigation');
    const growthModel = buildSectionModelForSave('growth');
    const climateModel = buildSectionModelForSave('climate');
    const agrotechnicsModel = buildSectionModelForSave('agrotechnics');
    const plantProtectionModel = buildSectionModelForSave('plantProtection');
    const yieldModel = buildSectionModelForSave('yield');
    const yieldData = {
        ...normalizeYieldData(yieldModel.data?.yieldData || {}),
        sharedData: normalizeYieldData(yieldModel.sharedData?.yieldData || yieldModel.sharedData || {}),
        byTreatment: Array.isArray(yieldModel.byTreatment)
            ? yieldModel.byTreatment.map((entry) => normalizeYieldData(entry?.yieldData || entry))
            : []
    };

    const experimentSiteSelection = document.getElementById('experiment-site')?.value || '';
    const experimentSiteOther = document.getElementById('experiment-site-other')?.value.trim() || '';
    const studyType = getCurrentStudyType();
    const labCellNumber = document.getElementById('lab-cell-number')?.value.trim() || '';
    const resolvedExperimentSite = experimentSiteSelection === 'other'
        ? experimentSiteOther
        : experimentSiteSelection;

    const visibility = getVisibilityFromUI ? getVisibilityFromUI() : (document.getElementById('experiment-visibility')?.value || 'public');
    const privateUntilTimestamp = getPrivateUntilFromUI ? getPrivateUntilFromUI() : null;
    const publicAccess = getPublicAccessFromUI ? getPublicAccessFromUI() : { canRead: true, canWrite: false };

    return {
        visibility: visibility,
        privateUntil: privateUntilTimestamp,
        publicAccess: publicAccess,
        leadResearcher: document.getElementById('lead-researcher')?.value || '',
        partners,
        experimentPartners: collectExperimentPartners(),
        creatorName: document.getElementById('experiment-creator')?.value || '',
        experimentYear: document.getElementById('experiment-year')?.value || '',
        experimentMonth: document.getElementById('experiment-month')?.value || '',
        researchPeriod: document.getElementById('research-period')?.value || '',
        studyType,
        workPackage: document.getElementById('work-package')?.value || '',
        experimentSite: resolvedExperimentSite,
        experimentSiteSelection,
        experimentSiteOther: experimentSiteSelection === 'other' ? experimentSiteOther : '',
        siteCoordinates: studyType === 'field' ? (document.getElementById('site-coordinates')?.value || '') : '',
        labCellNumber: studyType === 'lab' ? labCellNumber : '',
        experimentGoal: document.getElementById('experiment-goal')?.value || '',
        experimentSummary: document.getElementById('experiment-summary')?.value || '',
        treatmentsCount: parseInt(document.getElementById('treatments-count')?.value) || 0,
        repetitionsCount: getCurrentRepetitionsCount(),
        treatments,
        independentVariables,
        levelsCount: parseInt(document.getElementById('levels-count')?.value) || 0,
        levelValue: document.getElementById('level-value')?.value || '',
        dependentVariables,
        keywords,
        cropDetails: {
            shared: cropModel.shared,
            data: cropModel.data,
            sharedData: cropModel.sharedData,
            byTreatment: cropModel.byTreatment
        },
        structureDetails: {
            shared: structureModel.shared,
            data: structureModel.data,
            sharedData: structureModel.sharedData,
            byTreatment: structureModel.byTreatment
        },
        soilDetails: {
            shared: soilModel.shared,
            data: soilModel.data,
            sharedData: soilModel.sharedData,
            byTreatment: soilModel.byTreatment
        },
        dripDetails: {
            shared: dripModel.shared,
            data: dripModel.data,
            sharedData: dripModel.sharedData,
            byTreatment: dripModel.byTreatment
        },
        irrigationData: irrigationModel.data.irrigationData || [],
        fertilizationData: irrigationModel.data.fertilizationData || [],
        growthData: growthModel.data.growthData || [],
        climateData: climateModel.data.climateData || [],
        agrotechnicsData: agrotechnicsModel.data.agrotechnicsData || [],
        plantProtectionData: plantProtectionModel.data.plantProtectionData || { pests: [], diseases: [], sprays: [], drenches: [] },
        yieldData,
        sectionSharedState: {
            crop: cropModel,
            structure: structureModel,
            soil: soilModel,
            drip: dripModel,
            irrigation: irrigationModel,
            growth: growthModel,
            climate: climateModel,
            agrotechnics: agrotechnicsModel,
            plantProtection: plantProtectionModel,
            yield: yieldModel
        },
        events: collectEventsData(),
        financialData: collectFinancialData(),
        updatedAt: serverTimestamp()
    };
}

// =========================================
// Save Experiment
// =========================================
async function saveExperiment() {
    if (!currentUser || !currentExperimentId || !experimentOwnerUid) return false;

    if (!permissionsState?.canEdit) {
        showToast('אין הרשאת עריכה', 'error');
        return false;
    }

    const formData = collectFormData();

    // ולידציית שדות פרטיות
    if (formData.visibility === 'private') {
        if (!formData.privateUntil) {
            showToast('חובה להזין תאריך סיום פרטיות כאשר הניסוי מסומן כפרטי.', 'warning');
            return false;
        }
        const privateUntilDate = formData.privateUntil.toDate();
        if (privateUntilDate <= getTrustedNow()) {
            showToast('תאריך סיום פרטיות חייב להיות עתידי.', 'warning');
            return false;
        }
    }

    // ולידציה: תאריך תפוגה פרטי מוגבל עד 30/04 של שנת המחקר הנוכחית
    if (formData.visibility === 'private' && formData.privateUntil) {
        const privateDate = formData.privateUntil.toDate();
        const researchYear = privateDate.getFullYear();
        const maxAllowedDate = new Date(researchYear, 3, 30, 23, 59, 59); // April 30
        if (privateDate > maxAllowedDate) {
            showToast('תאריך סיום פרטיות לא יכול לעבור את 30/04/' + researchYear + ' (סוף שנת המחקר)', 'warning');
            return false;
        }
    }

    const structureEntries = getSectionValidationEntries(formData.structureDetails);
    for (const entry of structureEntries) {
        if (entry?.cellTempMode === 'קבועה' && !hasValue(entry.cellTempFixed)) {
            showToast("בטמפ' תא קבועה חובה להזין טמפ'", 'warning');
            return false;
        }
        if (entry?.cellTempMode === 'משתנה'
            && (!hasValue(entry.cellTempMinNight) || !hasValue(entry.cellTempMaxDay))) {
            showToast("בטמפ' תא משתנה חובה להזין מינימום ומקסימום", 'warning');
            return false;
        }
    }

    const plantProtection = formData.plantProtectionData || {};
    const inoculationRows = [
        ...(plantProtection.pests || []),
        ...(plantProtection.diseases || [])
    ];
    const missingMethod = inoculationRows.find(row => row?.inoculationType === 'מלאכותי' && !hasValue(row?.inoculationMethod));
    if (missingMethod) {
        showToast('כאשר סוג האילוח הוא מלאכותי חובה לבחור שיטת אילוח', 'warning');
        return false;
    }

    try {
        // אם אין הרשאת ניהול - אל נשנה גרעין הרשאות/פרטיות
        if (!permissionsState?.canManage) {
            formData.permissions = experimentData?.permissions || {};
            formData.visibility = experimentData?.visibility || formData.visibility;
            formData.publicAccess = experimentData?.publicAccess || formData.publicAccess;
        } else {
            // מנהל/בעלים יכולים לעדכן הרשאות מתוך ה-UI
            formData.permissions = collectPermissionsFromUI() || formData.permissions;
        }

        // שמור לבעלים של הניסוי
        const experimentRef = doc(db, "users", experimentOwnerUid, "experiments", currentExperimentId);
        await updateDoc(experimentRef, formData);
        await persistDynamicFieldOptions(formData);

        // עדכן שותפים - הוסף/הסר את הניסוי מהאוסף sharedExperiments שלהם
        // Build combined partners list from new permissions + legacy partners
        const newPermissionsPartners = Object.keys(permissionsUIData)
            .map(uid => {
                const user = allUsers.find(u => u.uid === uid);
                return user ? { email: user.email, name: user.fullName || user.email } : null;
            })
            .filter(Boolean);
        const allPartners = [...newPermissionsPartners];
        // Add legacy partners that might not be in permissions
        (formData.partners || []).forEach(p => {
            if (p.email && !allPartners.find(ap => ap.email?.toLowerCase() === p.email?.toLowerCase())) {
                allPartners.push(p);
            }
        });
        const syncResult = await syncSharedExperiments(allPartners, formData);

        experimentData = { ...experimentData, ...formData };
        generateTreatmentTabs();
        lastSavedFormSignature = getFormSignatureFromData(formData);
        hasUserEditedSinceSave = false;
        persistNavigationState();

        showToast('נשמר בהצלחה!', 'success');
        return true;
    } catch (error) {
        console.error("Error saving experiment:", error);
        showToast('שגיאה בשמירת הניסוי: ' + error.message, 'error');
        return false;
    }
}

function updateExperimentSiteOtherVisibility() {
    const siteSelect = document.getElementById('experiment-site');
    const siteOtherInput = document.getElementById('experiment-site-other');
    if (!siteSelect || !siteOtherInput) return;

    const shouldShow = siteSelect.value === 'other';
    siteOtherInput.style.display = shouldShow ? 'block' : 'none';
    if (!shouldShow) siteOtherInput.value = '';
}

function updateStudyTypeVisibility() {
    const isLab = getCurrentStudyType() === 'lab';
    const siteLabel = document.getElementById('site-field-label');
    const coordinatesGroup = document.getElementById('site-coordinates-group');
    const labCellGroup = document.getElementById('lab-cell-number-group');
    const pickLocationBtn = document.getElementById('pick-location-btn');
    const plantingDensityGroup = document.getElementById('planting-density-group');
    const potsCountGroup = document.getElementById('pots-count-group');
    const seedlingsPerPotGroup = document.getElementById('seedlings-per-pot-group');

    syncStudyTypeToggle();

    if (siteLabel) siteLabel.textContent = isLab ? "מס' תא:" : 'קורדינטות אתר הניסוי:';
    if (coordinatesGroup) coordinatesGroup.style.display = isLab ? 'none' : 'block';
    if (labCellGroup) labCellGroup.style.display = isLab ? 'block' : 'none';
    if (pickLocationBtn) pickLocationBtn.disabled = !permissionsState?.canEdit || isLab;

    if (plantingDensityGroup) plantingDensityGroup.style.display = isLab ? 'none' : '';
    if (potsCountGroup) potsCountGroup.style.display = isLab ? '' : 'none';
    if (seedlingsPerPotGroup) seedlingsPerPotGroup.style.display = isLab ? '' : 'none';

    updateGoogleMapsButtonVisibility();
}

function updateStructureTemperatureVisibility() {
    const mode = document.getElementById('cell-temp-mode')?.value || '';
    const fixedGroup = document.getElementById('cell-temp-fixed-group');
    const minGroup = document.getElementById('cell-temp-min-group');
    const maxGroup = document.getElementById('cell-temp-max-group');
    const fixedInput = document.getElementById('cell-temp-fixed');
    const minInput = document.getElementById('cell-temp-min-night');
    const maxInput = document.getElementById('cell-temp-max-day');

    if (fixedGroup) fixedGroup.style.display = mode === 'קבועה' ? '' : 'none';
    if (minGroup) minGroup.style.display = mode === 'משתנה' ? '' : 'none';
    if (maxGroup) maxGroup.style.display = mode === 'משתנה' ? '' : 'none';

    if (mode !== 'קבועה' && fixedInput) fixedInput.value = '';
    if (mode !== 'משתנה') {
        if (minInput) minInput.value = '';
        if (maxInput) maxInput.value = '';
    }
}

function renderDripIrrigationTimes(times = []) {
    const container = document.getElementById('drip-irrigation-times-container');
    if (!container) return;
    container.innerHTML = '';
    times.forEach((time, index) => {
        const row = document.createElement('div');
        row.className = 'drip-field-row';
        row.innerHTML = `
            <label class="drip-field-label">שעת השקיה ${index + 1}:</label>
            <div class="drip-field-value">
                <input type="time" class="drip-irrigation-time" value="${time || ''}">
            </div>
        `;
        container.appendChild(row);
    });
}

function updateDripIrrigationTimesCount() {
    const count = Math.max(0, parseInt(document.getElementById('drip-irrigations-per-day')?.value || '0', 10) || 0);
    const current = collectDripIrrigationTimes();
    const next = Array.from({ length: count }, (_, idx) => current[idx] || '');
    renderDripIrrigationTimes(next);
}

function collectDripIrrigationTimes() {
    return Array.from(document.querySelectorAll('.drip-irrigation-time'))
        .map((el) => el.value || '')
        .filter((value) => Boolean(value));
}

function updatePreparationNameVisibility() {
    const graftedPlantSelect = document.getElementById('grafted-plant');
    const preparationGroup = document.getElementById('preparation-name-group');
    const varietyTypeGroup = document.getElementById('variety-type-group');
    const varietyTypeSelect = document.getElementById('variety-type');
    const preparationInput = document.getElementById('preparation-name');
    if (!graftedPlantSelect || !preparationGroup || !varietyTypeGroup || !varietyTypeSelect) return;

    const showVarietyType = graftedPlantSelect.value === 'yes' || graftedPlantSelect.value === 'no';
    const showPreparation = graftedPlantSelect.value === 'yes';

    varietyTypeGroup.style.display = showVarietyType ? '' : 'none';
    preparationGroup.style.display = showPreparation ? '' : 'none';

    if (!showVarietyType) {
        varietyTypeSelect.value = '';
    }
    if (!showPreparation && preparationInput) {
        preparationInput.value = '';
    }
}

function updateDetachedSubstrateVisibility() {
    const detachedSubstrateSelect = document.getElementById('detached-substrate');
    if (!detachedSubstrateSelect) return;

    const shouldShow = detachedSubstrateSelect.value === 'כן';
    ['substrate-company', 'substrate-type', 'substrate-volume'].forEach((id) => {
        const input = document.getElementById(id);
        const group = input?.closest('.form-group');
        if (group) {
            group.style.display = shouldShow ? '' : 'none';
        }
    });
}

function updateAdiganAmountVisibility() {
    const disinfectionAdiganSelect = document.getElementById('soil-disinfection-adigan');
    const adiganAmountSelect = document.getElementById('soil-adigan-amount');
    const adiganAmountCustomInput = document.getElementById('soil-adigan-amount-custom');

    if (!disinfectionAdiganSelect || !adiganAmountSelect || !adiganAmountCustomInput) return;

    const shouldShowAmount = disinfectionAdiganSelect.value === 'כן';
    adiganAmountSelect.style.display = shouldShowAmount ? 'block' : 'none';

    if (!shouldShowAmount) {
        adiganAmountSelect.value = '';
        adiganAmountCustomInput.value = '';
        adiganAmountCustomInput.style.display = 'none';
        return;
    }

    const shouldShowCustom = adiganAmountSelect.value === 'other';
    adiganAmountCustomInput.style.display = shouldShowCustom ? 'block' : 'none';
    if (!shouldShowCustom) adiganAmountCustomInput.value = '';
}

function updateConditionalFieldVisibility() {
    updateStudyTypeVisibility();
    updateExperimentSiteOtherVisibility();
    updatePreparationNameVisibility();
    updateStructureTemperatureVisibility();
    updateDripIrrigationTimesCount();
    updateDetachedSubstrateVisibility();
    updateAdiganAmountVisibility();
    updateVisibilityFields();
}

function updateVisibilityFields() {
    const visibilitySelect = document.getElementById('experiment-visibility');
    const privateUntilGroup = document.getElementById('private-until-group');
    if(visibilitySelect && privateUntilGroup) {
        // מניעת הוספת listener כפול
        if (!visibilitySelect.dataset.listenerAttached) {
            visibilitySelect.addEventListener('change', () => {
                privateUntilGroup.style.display = visibilitySelect.value === 'private' ? 'block' : 'none';
            });
            visibilitySelect.dataset.listenerAttached = 'true';
        }
        // סנכרון מצב נוכחי
        privateUntilGroup.style.display = visibilitySelect.value === 'private' ? 'block' : 'none';
    }
}

// =========================================
// Permissions UI – state
// =========================================
let permissionsUIData = {}; // uid → { role, addedAt, addedBy }
let selectedPermissionUser = null; // user object chosen from autocomplete

// =========================================
// populatePermissionsUI – runs after loadExperiment
// =========================================
function populatePermissionsUI(data) {
    // --- visibility radios ---
    const vis = data.visibility || 'public';
    const radioPublic  = document.getElementById('visibility-public');
    const radioPrivate = document.getElementById('visibility-private');
    if (radioPublic)  radioPublic.checked  = vis === 'public';
    if (radioPrivate) radioPrivate.checked = vis === 'private';

    // Show/hide panels
    syncVisibilityPanels(vis);

    // --- private-until date ---
    const privateUntilInput = document.getElementById('private-until-date');
    if (privateUntilInput) {
        if (data.privateUntil) {
            const d = data.privateUntil.toDate
                ? data.privateUntil.toDate()
                : new Date(data.privateUntil.seconds * 1000);
            privateUntilInput.value = d.toISOString().slice(0, 10);
        } else {
            privateUntilInput.value = '';
        }
    }

    // --- publicAccess.canWrite ---
    const canWriteChk = document.getElementById('public-can-write');
    if (canWriteChk) {
        canWriteChk.checked = data.publicAccess?.canWrite === true;
        syncPublicWriteWarning(canWriteChk.checked);
    }

    // --- permissions table ---
    // Start from existing permissions map; merge in legacy partners as editors
    permissionsUIData = {};

    if (data.permissions && typeof data.permissions === 'object') {
        Object.entries(data.permissions).forEach(([uid, perm]) => {
            permissionsUIData[uid] = {
                role:    perm.role    || 'viewer',
                addedAt: perm.addedAt || null,
                addedBy: perm.addedBy || 'migration'
            };
        });
    }

    // Legacy: partners array → treat as editors if not already in permissions
    if (Array.isArray(data.partners)) {
        data.partners.forEach(partner => {
            if (!partner.email) return;
            const u = allUsers.find(u => u.email?.toLowerCase() === partner.email?.toLowerCase());
            if (u && u.uid && !permissionsUIData[u.uid]) {
                permissionsUIData[u.uid] = { role: 'editor', addedAt: null, addedBy: 'legacy' };
            }
        });
    }

    renderPermissionsTable();
}

// =========================================
// renderPermissionsTable
// =========================================
function renderPermissionsTable() {
    const tbody = document.getElementById('permissions-table-body');
    const emptyState = document.getElementById('permissions-empty-state');
    if (!tbody) return;

    tbody.innerHTML = '';
    const entries = Object.entries(permissionsUIData);

    if (entries.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

    entries.forEach(([uid, perm]) => {
        const user = allUsers.find(u => u.uid === uid);
        const name  = user?.fullName || user?.email || uid;
        const email = user?.email || '';
        const role  = perm.role || 'viewer';

        const tr = document.createElement('tr');

        // Name
        const tdName = document.createElement('td');
        tdName.textContent = name;
        tr.appendChild(tdName);

        // Email
        const tdEmail = document.createElement('td');
        tdEmail.textContent = email;
        tdEmail.style.direction = 'ltr';
        tdEmail.style.textAlign = 'left';
        tr.appendChild(tdEmail);

        // Role
        const tdRole = document.createElement('td');
        if (permissionsState.canManage) {
            const sel = document.createElement('select');
            sel.className = 'perm-inline-role-select';
            sel.dataset.uid = uid;
            [['viewer', 'צפייה בלבד'], ['editor', 'עריכה']].forEach(([val, label]) => {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = label;
                if (val === role) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () => {
                if (permissionsUIData[uid]) {
                    permissionsUIData[uid].role = sel.value;
                }
                markUserEdited();
            });
            tdRole.appendChild(sel);
        } else {
            const badge = document.createElement('span');
            badge.className = `role-badge badge-${role}`;
            badge.textContent = role === 'editor' ? 'עריכה' : 'צפייה בלבד';
            tdRole.appendChild(badge);
        }
        tr.appendChild(tdRole);

        // Actions
        const tdActions = document.createElement('td');
        if (permissionsState.canManage) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn-remove-perm';
            removeBtn.innerHTML = '<i class="fas fa-user-minus"></i> הסרה';
            removeBtn.addEventListener('click', async () => {
                const confirmed = await showConfirmModal({
                    title: 'הסרת שותף',
                    message: `האם להסיר את הגישה של ${name}?`,
                    confirmText: 'הסרה',
                    cancelText: 'ביטול',
                    tone: 'warning'
                });
                if (!confirmed) return;
                delete permissionsUIData[uid];
                renderPermissionsTable();
                markUserEdited();
            });
            tdActions.appendChild(removeBtn);
        } else {
            tdActions.textContent = '—';
        }
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}

// =========================================
// collectPermissionsFromUI
// =========================================
function collectPermissionsFromUI() {
    // Read changes from inline role selects (they already update permissionsUIData on change)
    // Also ensure any pending select values are captured
    document.querySelectorAll('.perm-inline-role-select').forEach(sel => {
        const uid = sel.dataset.uid;
        if (uid && permissionsUIData[uid]) {
            permissionsUIData[uid].role = sel.value;
        }
    });

    // Convert to Firestore-ready format
    const result = {};
    Object.entries(permissionsUIData).forEach(([uid, perm]) => {
        result[uid] = {
            role:    perm.role || 'viewer',
            addedAt: perm.addedAt || Timestamp.now(),
            addedBy: perm.addedBy || currentUser?.uid || 'unknown'
        };
    });
    return result;
}

// =========================================
// getVisibilityFromUI
// =========================================
function getVisibilityFromUI() {
    return document.getElementById('visibility-private')?.checked ? 'private' : 'public';
}

// =========================================
// getPublicAccessFromUI
// =========================================
function getPublicAccessFromUI() {
    return {
        canRead:  true,
        canWrite: false
    };
}

// =========================================
// getPrivateUntilFromUI
// =========================================
function getPrivateUntilFromUI() {
    const vis = getVisibilityFromUI();
    const val = document.getElementById('private-until-date')?.value;
    if (vis === 'private' && val) {
        return Timestamp.fromDate(new Date(val + 'T23:59:59'));
    }
    return null;
}

// =========================================
// syncVisibilityPanels – show/hide based on radio
// =========================================
function syncVisibilityPanels(vis) {
    const privatePanel = document.getElementById('private-until-panel');
    const publicPanel  = document.getElementById('public-access-panel');
    if (privatePanel) privatePanel.style.display = vis === 'private' ? 'block' : 'none';
    if (publicPanel)  publicPanel.style.display  = vis === 'public'  ? 'block' : 'none';
}

// =========================================
// syncPublicWriteWarning
// =========================================
function syncPublicWriteWarning(checked) {
    const warning = document.getElementById('public-write-warning');
    if (warning) warning.style.display = checked ? 'flex' : 'none';
}

function applyReadOnlyInteractiveLocks() {
    const isReadOnly = !permissionsState?.canEdit;
    const pickLocationBtn = document.getElementById('pick-location-btn');
    const sharedToggle = document.getElementById('shared-data-toggle');

    document.querySelectorAll('.study-type-option').forEach((button) => {
        button.disabled = isReadOnly;
    });

    if (pickLocationBtn) {
        pickLocationBtn.disabled = isReadOnly || getCurrentStudyType() === 'lab';
    }

    if (sharedToggle) {
        sharedToggle.disabled = isReadOnly;
    }
}

// =========================================
// applyPermissions – called after loadExperiment
// =========================================
function applyPermissions() {
    const section = document.getElementById('permissions-section');
    const form    = document.getElementById('experiment-form');
    const viewerNotice = document.getElementById('viewer-notice');
    const addArea = document.getElementById('add-permission-partner-area');

    const role = permissionsState.role;

    // Populate the new permissions UI
    populatePermissionsUI(experimentData);

    // --- Viewer: show notice, lock form ---
    if (!permissionsState.canEdit) {
        if (viewerNotice) viewerNotice.style.display = 'flex';
        if (form) form.classList.add('readonly-mode');
    } else {
        if (viewerNotice) viewerNotice.style.display = 'none';
        if (form) form.classList.remove('readonly-mode');
    }

    applyReadOnlyInteractiveLocks();

    // --- Not manager: lock permissions section ---
    if (!permissionsState.canManage) {
        if (section) section.classList.add('locked');
        if (addArea) addArea.style.display = 'none';
        // Disable visibility radios
        document.querySelectorAll('input[name="experiment-visibility"]').forEach(r => r.disabled = true);
        const canWriteChk = document.getElementById('public-can-write');
        if (canWriteChk) canWriteChk.disabled = true;
    } else {
        if (section) section.classList.remove('locked');
        if (addArea) addArea.style.display = 'flex';
        document.querySelectorAll('input[name="experiment-visibility"]').forEach(r => r.disabled = false);
        const canWriteChk = document.getElementById('public-can-write');
        if (canWriteChk) canWriteChk.disabled = false;
    }

    // Hide save button for viewers (just in case readonly-mode isn't enough)
    const saveBtns = document.querySelectorAll('.btn-save, [id="btn-save-experiment"]');
    saveBtns.forEach(btn => {
        btn.style.display = permissionsState.canEdit ? '' : 'none';
    });
}

// =========================================
// initPermissionsUI – event listeners for permission section
// =========================================
function initPermissionsUI() {
    // Toggle header
    const toggleBtn = document.getElementById('permissions-toggle-btn');
    const toggleContent = document.getElementById('permissions-section-content');
    const permissionsSection = document.getElementById('permissions-section');
    
    if (toggleBtn && toggleContent && permissionsSection) {
        toggleBtn.addEventListener('click', () => {
            const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
            toggleBtn.setAttribute('aria-expanded', !isExpanded);
            
            if (isExpanded) {
                toggleContent.style.display = 'none';
                permissionsSection.classList.remove('is-open');
            } else {
                toggleContent.style.display = 'block';
                permissionsSection.classList.add('is-open');
            }
        });
    }

    // Visibility radios
    document.querySelectorAll('input[name="experiment-visibility"]').forEach(radio => {
        radio.addEventListener('change', () => {
            syncVisibilityPanels(radio.value);
            markUserEdited();
        });
    });

    // Public-can-write checkbox
    const canWriteChk = document.getElementById('public-can-write');
    if (canWriteChk) {
        canWriteChk.addEventListener('change', () => {
            syncPublicWriteWarning(canWriteChk.checked);
            markUserEdited();
        });
    }

    // Autocomplete for permission partner search
    const searchInput = document.getElementById('permission-partner-search');
    const suggestionsDiv = document.getElementById('permission-partner-suggestions');

    if (searchInput && suggestionsDiv) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            suggestionsDiv.innerHTML = '';
            selectedPermissionUser = null;

            if (!query || query.length < 2) {
                suggestionsDiv.classList.remove('active');
                return;
            }

            const filtered = allUsers.filter(u => {
                const alreadyAdded = !!permissionsUIData[u.uid];
                const isOwner = u.uid === experimentOwnerUid;
                const matchQuery = (u.fullName?.toLowerCase().includes(query) ||
                                   u.email?.toLowerCase().includes(query));
                return matchQuery && !alreadyAdded && !isOwner;
            }).slice(0, 8);

            if (!filtered.length) {
                suggestionsDiv.classList.remove('active');
                return;
            }

            filtered.forEach(u => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.innerHTML = `
                    <div class="suggestion-name">${u.fullName || '—'}</div>
                    <div class="suggestion-email">${u.email || ''}</div>
                `;
                item.addEventListener('click', () => {
                    selectedPermissionUser = u;
                    searchInput.value = u.fullName || u.email || '';
                    suggestionsDiv.innerHTML = '';
                    suggestionsDiv.classList.remove('active');
                });
                suggestionsDiv.appendChild(item);
            });

            suggestionsDiv.classList.add('active');
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
                suggestionsDiv.classList.remove('active');
            }
        });
    }

    // Add permission partner button
    const addBtn = document.getElementById('add-permission-partner-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (!selectedPermissionUser) {
                showToast('יש לבחור משתמש מהרשימה', 'warning');
                return;
            }
            const roleSelect = document.getElementById('permission-role-select');
            const role = roleSelect?.value || 'viewer';
            const uid = selectedPermissionUser.uid;

            if (permissionsUIData[uid]) {
                showToast('המשתמש כבר נמצא ברשימה', 'warning');
                return;
            }

            permissionsUIData[uid] = {
                role,
                addedAt: Timestamp.now(),
                addedBy: currentUser?.uid || 'unknown'
            };

            const addedName = selectedPermissionUser.fullName || selectedPermissionUser.email || 'שותף';

            renderPermissionsTable();
            markUserEdited();

            // Reset search
            if (searchInput) searchInput.value = '';
            selectedPermissionUser = null;
            if (suggestionsDiv) {
                suggestionsDiv.innerHTML = '';
                suggestionsDiv.classList.remove('active');
            }

            showToast(`${addedName} נוסף כ${role === 'editor' ? 'עורך' : 'צופה'}`, 'success');
        });
    }
}

// =========================================
// Sync Shared Experiments
// =========================================

async function syncSharedExperiments(currentPartners, latestExperimentData = null) {
    // רק הבעלים המקורי יכול לסנכרן שותפים
    if (experimentOwnerUid !== currentUser.uid) return { added: 0, removed: 0 };

    let addedCount = 0;
    let removedCount = 0;

    try {
        // בדיקה שיש לנו את רשימת המשתמשים
        if (allUsers.length === 0) {
            showToast('שגיאה: לא ניתן לסנכרן שותפים. נסה לרענן את הדף.', 'warning');
            return { added: 0, removed: 0 };
        }

        // מצא את כל המשתמשים שהם שותפים כרגע
        const partnerEmails = currentPartners.map(p => p.email).filter(e => e);

        // מצא את ה-UID של כל שותף
        for (const partner of currentPartners) {
            if (!partner.email) continue;

            // מצא את המשתמש לפי האימייל (case-insensitive)
            const partnerUser = allUsers.find(u => u.email.toLowerCase() === partner.email.toLowerCase());

            if (partnerUser && partnerUser.uid) {
                const cachedExperiment = {
                    experimentName: latestExperimentData?.experimentName ?? experimentData?.experimentName ?? '',
                    experimentYear: latestExperimentData?.experimentYear ?? experimentData?.experimentYear ?? '',
                    experimentSite: latestExperimentData?.experimentSite ?? experimentData?.experimentSite ?? '',
                    siteCoordinates: latestExperimentData?.siteCoordinates ?? experimentData?.siteCoordinates ?? '',
                    workPackage: latestExperimentData?.workPackage ?? experimentData?.workPackage ?? '',
                    keywords: Array.isArray(latestExperimentData?.keywords)
                        ? latestExperimentData.keywords
                        : (Array.isArray(experimentData?.keywords) ? experimentData.keywords : []),
                    cropDetails: latestExperimentData?.cropDetails ?? experimentData?.cropDetails ?? null,
                    createdAt: experimentData?.createdAt || null,
                    updatedAt: serverTimestamp()
                };

                // הוסף אסמכתא לניסוי באוסף sharedExperiments של השותף
                const sharedRef = doc(db, "users", partnerUser.uid, "sharedExperiments", currentExperimentId);
                await setDoc(sharedRef, {
                    experimentId: currentExperimentId,
                    ownerUid: currentUser.uid,
                    ownerEmail: currentUser.email,
                    addedAt: serverTimestamp(),
                    cachedExperiment
                }, { merge: true });

                addedCount++;
            } else {
                showToast(`לא נמצא משתמש עם האימייל: ${partner.email}`, 'warning');
            }
        }

        // הסר שותפים שכבר לא ברשימה (אם יש רשימה קודמת)
        if (experimentData?.partners) {
            const previousPartners = experimentData.partners;
            for (const oldPartner of previousPartners) {
                if (!oldPartner.email) continue;
                // אם השותף הישן לא נמצא ברשימה החדשה
                if (!partnerEmails.includes(oldPartner.email)) {
                    const oldUser = allUsers.find(u => u.email.toLowerCase() === oldPartner.email.toLowerCase());
                    if (oldUser && oldUser.uid) {
                        // הסר את האסמכתא
                        const sharedRef = doc(db, "users", oldUser.uid, "sharedExperiments", currentExperimentId);
                        try {
                            await deleteDoc(sharedRef);
                            removedCount++;
                        } catch (e) {
                            // התעלם משגיאות מחיקה
                        }
                    }
                }
            }
        }

        return { added: addedCount, removed: removedCount };
    } catch (error) {
        console.error("Error syncing shared experiments:", error);
        showToast('שגיאה בסנכרון שותפים: ' + error.message, 'error');
        return { added: 0, removed: 0 };
    }
}

// =========================================
// Event Listeners
// =========================================
function initEventListeners() {
    initBrowserNavigationGuard();

    // Hamburger menu (Mobile)
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (hamburgerBtn && sidebar) {
        hamburgerBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
            // Change icon
            const icon = hamburgerBtn.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-times');
            }
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
            const icon = hamburgerBtn?.querySelector('i');
            if (icon) {
                icon.classList.add('fa-bars');
                icon.classList.remove('fa-times');
            }
        });
    }

    // Form submit
    const form = document.getElementById('experiment-form');
    if (form) {
        form.setAttribute('novalidate', 'novalidate');
        form.addEventListener('input', () => markUserEdited());
        form.addEventListener('change', () => markUserEdited());
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveExperiment();
        });
    }

    window.addEventListener('scroll', schedulePersistNavigationState, { passive: true });
    window.addEventListener('beforeunload', persistNavigationState);
    window.addEventListener('beforeunload', (event) => {
        if (!hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = '';
    });


    // Treatment count change
    const treatmentsCount = document.getElementById('treatments-count');
    if (treatmentsCount) {
        treatmentsCount.addEventListener('change', () => {
            persistCurrentSectionDataToState();
            const count = parseInt(treatmentsCount.value) || 0;
            const existingTreatments = collectTreatmentInputsFromDOM();
            generateTreatmentInputs(count, existingTreatments, getCurrentRepetitionsCount());
            syncAllSectionTreatmentCounts();
            currentTreatmentIndex = Math.max(0, Math.min(currentTreatmentIndex, Math.max(count - 1, 0)));
            generateTreatmentTabs();
            loadCurrentSectionDataFromState();
        });
    }

    const repetitionsCount = document.getElementById('repetitions-count');
    if (repetitionsCount) {
        repetitionsCount.addEventListener('change', () => {
            persistCurrentSectionDataToState();
            const existingTreatments = collectTreatmentInputsFromDOM();
            const rawValue = parseInt(repetitionsCount.value);
            const clampedRepetitionsCount = Math.min(MAX_REPETITIONS_PER_TREATMENT, Math.max(1, rawValue || 0));
            if (Number.isFinite(rawValue) && rawValue > MAX_REPETITIONS_PER_TREATMENT) {
                showToast(`המספר הוגבל ל־${MAX_REPETITIONS_PER_TREATMENT} כדי למנוע עומס על הדפדפן`, 'warning');
            }
            repetitionsCount.value = String(clampedRepetitionsCount);
            generateTreatmentInputs(getCurrentTreatmentsCount(), existingTreatments, clampedRepetitionsCount);
        });
    }

    const sharedToggle = document.getElementById('shared-data-toggle');
    if (sharedToggle) {
        sharedToggle.addEventListener('change', async () => {
            if (isSyncingSharedToggle) return;

            const sectionId = getSectionIdByView();
            if (!sectionId) return;

            persistCurrentSectionDataToState();

            const model = getSectionModel(sectionId);
            const targetShared = sharedToggle.checked;

            if (model?.shared === false && targetShared === true) {
                const confirmed = await showConfirmModal({
                    title: 'אישור הפעלת נתונים זהים',
                    message: 'שימו לב: הפעלת מצב "נתונים זהים לכלל הטיפולים" תדרוס נתונים ייחודיים בטיפולים האחרים ותחליף אותם בנתוני טיפול 1.\nהשינוי יישמר בפועל רק לאחר לחיצה על "שמירה". האם להמשיך?',
                    confirmText: 'כן, להמשיך',
                    cancelText: 'ביטול',
                    tone: 'warning'
                });
                if (!confirmed) {
                    isSyncingSharedToggle = true;
                    sharedToggle.checked = false;
                    isSyncingSharedToggle = false;
                    return;
                }
            }

            setSectionSharedState(sectionId, targetShared);
            loadCurrentSectionDataFromState();
            syncSharedToggleForCurrentView();
            await alertDeferredChange('השינוי במצב "נתונים זהים לכלל הטיפולים"');
        });
    }

    // Add variables
    const addIndependent = document.getElementById('add-independent-var');
    const newIndependent = document.getElementById('new-independent-var');
    if (addIndependent && newIndependent) {
        addIndependent.addEventListener('click', () => {
            if (newIndependent.value.trim()) {
                addVariableRow('independent', newIndependent.value.trim());
                newIndependent.value = '';
            }
        });
        newIndependent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addIndependent.click();
            }
        });
    }

    const addDependent = document.getElementById('add-dependent-var');
    const newDependent = document.getElementById('new-dependent-var');
    if (addDependent && newDependent) {
        addDependent.addEventListener('click', () => {
            if (newDependent.value.trim()) {
                addVariableRow('dependent', newDependent.value.trim());
                newDependent.value = '';
            }
        });
        newDependent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addDependent.click();
            }
        });
    }

    // Add keyword
    const addKeyword = document.getElementById('add-keyword');
    const keywordsSelect = document.getElementById('keywords-select');
    const customKeywordContainer = document.getElementById('custom-keyword-container');
    const customKeywordInput = document.getElementById('custom-keyword-input');
    const addCustomKeyword = document.getElementById('add-custom-keyword');
    const cancelCustomKeyword = document.getElementById('cancel-custom-keyword');

    if (addKeyword && keywordsSelect) {
        addKeyword.addEventListener('click', () => {
            if (keywordsSelect.value === '__custom__') {
                // Show custom input field
                if (customKeywordContainer) {
                    customKeywordContainer.style.display = 'flex';
                    if (customKeywordInput) customKeywordInput.focus();
                }
                keywordsSelect.value = '';
            } else if (keywordsSelect.value) {
                addKeywordTag(keywordsSelect.value);
                keywordsSelect.value = '';
            }
        });
    }

    // Add custom keyword from free text input
    if (addCustomKeyword && customKeywordInput) {
        addCustomKeyword.addEventListener('click', () => {
            const val = customKeywordInput.value.trim();
            if (val) {
                addKeywordTag(val);
                customKeywordInput.value = '';
                if (customKeywordContainer) customKeywordContainer.style.display = 'none';
            }
        });

        // Also support Enter key
        customKeywordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomKeyword.click();
            }
        });
    }

    // Cancel custom keyword input
    if (cancelCustomKeyword && customKeywordContainer) {
        cancelCustomKeyword.addEventListener('click', () => {
            if (customKeywordInput) customKeywordInput.value = '';
            customKeywordContainer.style.display = 'none';
        });
    }

    // Sidebar submenu toggles
    document.querySelectorAll('.sub-item.has-submenu').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            item.classList.toggle('expanded');
            const submenuId = item.dataset.submenu;
            const submenu = document.getElementById(submenuId);
            if (submenu) {
                submenu.classList.toggle('open');
            }
        });
    });

    // View switching from sidebar
    document.querySelectorAll('.sub-sub-item[data-view]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            requestViewSwitch(item.dataset.view);
        });
    });

    document.querySelectorAll('.sub-item[data-view]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            requestViewSwitch(item.dataset.view);
        });
    });

    document.querySelectorAll('.sidebar-nav a[href]:not([href="#"])').forEach(link => {
        link.addEventListener('click', async (e) => {
            const targetHref = link.getAttribute('href');
            if (!targetHref) return;

            e.preventDefault();
            const canProceed = await confirmUnsavedChangesBeforeAction('לא ביצעת שמירה. האם ברצונך לשמור לפני יציאה מהעמוד?');
            if (!canProceed) return;

            persistNavigationState(true);
            window.location.href = targetHref;
        });
    });

    // Experiment header toggle
    const expHeader = document.getElementById('current-experiment-header');
    if (expHeader) {
        expHeader.addEventListener('click', () => {
            expHeader.classList.toggle('expanded');
            const submenu = expHeader.nextElementSibling;
            if (submenu) {
                submenu.classList.toggle('open');
            }
        });
    }

    // Logout
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const canProceed = await confirmUnsavedChangesBeforeAction('לא ביצעת שמירה. האם ברצונך לשמור לפני התנתקות?');
            if (!canProceed) return;

            await signOut(auth);
            window.location.href = "login.html";
        });
    }

    // Location Picker
    initLocationPicker();

    // Soil dynamic tables
    initSoilTableListeners();

    // Progress views (מהלך הניסוי) dynamic tables
    initProgressListeners();

    // Drip edit buttons – focus the paired input
    document.querySelectorAll('.drip-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (target) target.focus();
        });
    });

    document.getElementById('experiment-site')?.addEventListener('change', updateExperimentSiteOtherVisibility);
    document.getElementById('study-type')?.addEventListener('change', updateStudyTypeVisibility);
    document.querySelectorAll('.study-type-option').forEach((button) => {
        button.addEventListener('click', () => {
            const selectedType = button.dataset.studyType;
            if (!selectedType) return;
            setStudyTypeValue(selectedType);
            updateStudyTypeVisibility();
        });
    });
    document.getElementById('grafted-plant')?.addEventListener('change', updatePreparationNameVisibility);
    document.getElementById('cell-temp-mode')?.addEventListener('change', updateStructureTemperatureVisibility);
    document.getElementById('drip-irrigations-per-day')?.addEventListener('change', updateDripIrrigationTimesCount);
    document.getElementById('detached-substrate')?.addEventListener('change', updateDetachedSubstrateVisibility);
    document.getElementById('soil-disinfection-adigan')?.addEventListener('change', updateAdiganAmountVisibility);
    document.getElementById('soil-adigan-amount')?.addEventListener('change', updateAdiganAmountVisibility);

    updateConditionalFieldVisibility();

    // Partners Autocomplete - נקרא אחרי טעינת הניסוי ב-loadExperiment
    // initPartnersAutocomplete();

    // Permissions UI event listeners
    initPermissionsUI();
}

// =========================================
// OpenStreetMap Location Picker (Leaflet - Free!)
// =========================================
let map = null;
let marker = null;
let selectedLocation = null;
let locationSearchDebounceId = null;
let locationSearchAbortController = null;

function initLocationPicker() {
    const pickLocationBtn = document.getElementById('pick-location-btn');
    const openGoogleMapsBtn = document.getElementById('open-google-maps-btn');
    const modal = document.getElementById('location-picker-modal');
    const closeBtn = document.getElementById('close-location-modal');
    const cancelBtn = document.getElementById('cancel-location');
    const confirmBtn = document.getElementById('confirm-location');
    const coordsInput = document.getElementById('site-coordinates');
    const searchInput = document.getElementById('location-search-input');
    const searchBtn = document.getElementById('location-search-btn');
    const currentBtn = document.getElementById('location-current-btn');
    const suggestionsContainer = document.getElementById('location-search-suggestions');

    if (!pickLocationBtn) return;

    // Open in Google Maps (external link - free!)
    if (openGoogleMapsBtn) {
        openGoogleMapsBtn.addEventListener('click', () => {
            const coords = parseCoordinates(coordsInput.value);
            if (coords) {
                const url = `https://www.google.com/maps?q=${coords.lat},${coords.lng}&z=15`;
                window.open(url, '_blank');
                showToast('נפתח בגוגל מפות בטאב חדש', 'info', 2000);
            } else {
                showToast('אין קורדינטות תקינות', 'warning');
            }
        });
    }

    pickLocationBtn.addEventListener('click', () => {
        openLocationModal();
    });

    if (searchBtn) {
        searchBtn.addEventListener('click', () => searchLocationFromInput());
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim();
            if (locationSearchDebounceId) {
                clearTimeout(locationSearchDebounceId);
            }

            if (query.length < 2) {
                hideLocationSuggestions();
                return;
            }

            locationSearchDebounceId = setTimeout(() => {
                showLocationAutocomplete(query);
            }, 300);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchLocationFromInput();
            }
        });
    }

    if (currentBtn) {
        currentBtn.addEventListener('click', () => setCurrentLocationOnMap());
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeLocationModal);
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeLocationModal);
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', confirmLocation);
    }

    // Close on overlay click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeLocationModal();
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!suggestionsContainer || !searchInput) return;
        const clickedInsideSuggestions = suggestionsContainer.contains(e.target);
        const clickedSearchInput = searchInput.contains(e.target);
        if (!clickedInsideSuggestions && !clickedSearchInput) {
            hideLocationSuggestions();
        }
    });

    // Watch for changes to coordinates
    if (coordsInput) {
        coordsInput.addEventListener('change', updateGoogleMapsButtonVisibility);
        coordsInput.addEventListener('input', updateGoogleMapsButtonVisibility);
    }
}

function openLocationModal() {
    const modal = document.getElementById('location-picker-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    updateLocationSearchStatus('');
    hideLocationSuggestions();

    // Initialize map if not already initialized
    if (!map) {
        // Delay to ensure modal is visible and container has dimensions
        setTimeout(() => initMap(), 100);
    } else {
        // Invalidate size to fix display issues after modal was hidden
        map.invalidateSize();
    }
}

function closeLocationModal() {
    const modal = document.getElementById('location-picker-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function initMap() {
    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    // Default center - Israel center coordinates
    const defaultCenter = [31.5, 34.75]; // [lat, lng]

    // Try to get existing coordinates from input
    const coordsInput = document.getElementById('site-coordinates');
    let initialCenter = defaultCenter;

    if (coordsInput && coordsInput.value) {
        const coords = parseCoordinates(coordsInput.value);
        if (coords) {
            initialCenter = [coords.lat, coords.lng];
        }
    }

    // Create Leaflet map with OpenStreetMap tiles (FREE!)
    map = L.map(mapContainer).setView(initialCenter, 12);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // Create custom icon for marker
    const customIcon = L.icon({
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    // Create draggable marker
    marker = L.marker(initialCenter, {
        draggable: true,
        icon: customIcon
    }).addTo(map);

    marker.bindPopup('גרירה או לחיצה על המפה').openPopup();

    selectedLocation = { lat: initialCenter[0], lng: initialCenter[1] };
    updateSelectedCoordinates(selectedLocation);

    // Update coordinates when marker is dragged
    marker.on('dragend', (event) => {
        const position = marker.getLatLng();
        selectedLocation = { lat: position.lat, lng: position.lng };
        updateSelectedCoordinates(selectedLocation);
    });

    // Allow clicking on map to place marker
    map.on('click', (event) => {
        const position = event.latlng;
        marker.setLatLng(position);
        selectedLocation = { lat: position.lat, lng: position.lng };
        updateSelectedCoordinates(selectedLocation);
    });
}

function updateSelectedCoordinates(location) {
    const coordsSpan = document.getElementById('selected-coordinates');
    if (coordsSpan) {
        coordsSpan.textContent = `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;
    }
}

function updateLocationSearchStatus(message = '', type = 'info') {
    const statusEl = document.getElementById('location-search-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    if (!message) {
        statusEl.style.color = '#666';
        return;
    }

    if (type === 'error') {
        statusEl.style.color = '#dc2626';
    } else if (type === 'success') {
        statusEl.style.color = '#15803d';
    } else {
        statusEl.style.color = '#666';
    }
}

function hideLocationSuggestions() {
    const suggestionsContainer = document.getElementById('location-search-suggestions');
    if (!suggestionsContainer) return;
    suggestionsContainer.style.display = 'none';
    suggestionsContainer.innerHTML = '';
}

function renderLocationSuggestions(results) {
    const suggestionsContainer = document.getElementById('location-search-suggestions');
    if (!suggestionsContainer) return;

    suggestionsContainer.innerHTML = '';
    if (!Array.isArray(results) || results.length === 0) {
        hideLocationSuggestions();
        return;
    }

    results.forEach((result) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.style.width = '100%';
        item.style.textAlign = 'right';
        item.style.padding = '8px 10px';
        item.style.border = 'none';
        item.style.borderBottom = '1px solid #f1f5f9';
        item.style.background = '#fff';
        item.style.cursor = 'pointer';
        item.style.fontSize = '13px';
        item.textContent = result.display_name || `${result.lat}, ${result.lon}`;

        item.addEventListener('mouseenter', () => {
            item.style.background = '#f8fafc';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = '#fff';
        });
        item.addEventListener('click', () => {
            const searchInput = document.getElementById('location-search-input');
            if (searchInput) searchInput.value = result.display_name || '';
            setSelectedLocationOnMap(result.lat, result.lon);
            hideLocationSuggestions();
            updateLocationSearchStatus(`נבחר: ${result.display_name}`, 'success');
        });

        suggestionsContainer.appendChild(item);
    });

    const lastChild = suggestionsContainer.lastElementChild;
    if (lastChild) {
        lastChild.style.borderBottom = 'none';
    }

    suggestionsContainer.style.display = 'block';
}

async function fetchLocationSearchResults(query, limit = 5) {
    if (locationSearchAbortController) {
        locationSearchAbortController.abort();
    }

    locationSearchAbortController = new AbortController();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
        signal: locationSearchAbortController.signal,
        headers: {
            'Accept': 'application/json',
            'Accept-Language': 'he'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const results = await response.json();
    return Array.isArray(results) ? results : [];
}

async function showLocationAutocomplete(query) {
    try {
        const results = await fetchLocationSearchResults(query, 5);
        renderLocationSuggestions(results);
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Location autocomplete failed:', error);
        hideLocationSuggestions();
    }
}

function setSelectedLocationOnMap(lat, lng, zoom = 15) {
    if (!map || !marker) {
        showToast('המפה עדיין בטעינה, נסה שוב בעוד רגע', 'warning');
        return;
    }

    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return;

    const position = L.latLng(parsedLat, parsedLng);
    marker.setLatLng(position);
    map.setView(position, zoom);
    selectedLocation = { lat: parsedLat, lng: parsedLng };
    updateSelectedCoordinates(selectedLocation);
}

async function searchLocationFromInput() {
    const searchInput = document.getElementById('location-search-input');
    const query = searchInput?.value.trim();

    if (!query) {
        updateLocationSearchStatus('יש להזין טקסט לחיפוש.', 'error');
        return;
    }

    if (!map || !marker) {
        updateLocationSearchStatus('המפה עדיין בטעינה, נסה שוב בעוד רגע.', 'error');
        return;
    }

    updateLocationSearchStatus('מחפש מיקום...');
    hideLocationSuggestions();

    try {
        const results = await fetchLocationSearchResults(query, 1);
        if (!Array.isArray(results) || results.length === 0) {
            updateLocationSearchStatus('לא נמצאו תוצאות לחיפוש.', 'error');
            return;
        }

        const result = results[0];
        setSelectedLocationOnMap(result.lat, result.lon);
        updateLocationSearchStatus(`נמצא: ${result.display_name}`, 'success');
    } catch (error) {
        console.error('Location search failed:', error);
        updateLocationSearchStatus('חיפוש נכשל. נסה שוב בעוד רגע.', 'error');
    }
}

function setCurrentLocationOnMap() {
    if (!navigator.geolocation) {
        updateLocationSearchStatus('הדפדפן לא תומך בזיהוי מיקום.', 'error');
        return;
    }

    if (!map || !marker) {
        updateLocationSearchStatus('המפה עדיין בטעינה, נסה שוב בעוד רגע.', 'error');
        return;
    }

    updateLocationSearchStatus('מאתר את המיקום הנוכחי...');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            setSelectedLocationOnMap(latitude, longitude);
            updateLocationSearchStatus('המיקום הנוכחי עודכן בהצלחה.', 'success');
        },
        (error) => {
            console.error('Geolocation failed:', error);
            updateLocationSearchStatus('לא ניתן לאתר את המיקום הנוכחי. בדוק הרשאות מיקום בדפדפן.', 'error');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function confirmLocation() {
    if (selectedLocation) {
        const coordsInput = document.getElementById('site-coordinates');
        if (coordsInput) {
            coordsInput.value = `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`;
            // Trigger change event to update Google Maps button
            coordsInput.dispatchEvent(new Event('change'));
        }
        closeLocationModal();
        showToast('המיקום נשמר בהצלחה', 'success');
    }
}

function parseCoordinates(coordsString) {
    try {
        const parts = coordsString.split(',').map(s => s.trim());
        if (parts.length === 2) {
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lng)) {
                return { lat, lng };
            }
        }
    } catch (e) {
        console.error('Failed to parse coordinates:', e);
    }
    return null;
}

// =========================================
// Experiment Partners (multi-select chips)
// =========================================
let selectedExperimentPartner = null;

function populateExperimentPartners(experimentPartners = []) {
    const listContainer = document.getElementById('experiment-partners-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    (experimentPartners || []).forEach(partner => {
        addExperimentPartnerChip(partner);
    });
}

function addExperimentPartnerChip(partnerData) {
    const listContainer = document.getElementById('experiment-partners-list');
    if (!listContainer) return;

    let name = '', email = '', uid = '';
    if (typeof partnerData === 'string') {
        name = partnerData;
    } else if (partnerData && typeof partnerData === 'object') {
        name = partnerData.name || '';
        email = partnerData.email || '';
        uid = partnerData.uid || '';
    }

    // Check for duplicate
    const existingChips = listContainer.querySelectorAll('.experiment-partner-chip');
    for (const chip of existingChips) {
        if (email && chip.dataset.email?.toLowerCase() === email.toLowerCase()) return;
        if (uid && chip.dataset.uid === uid) return;
    }

    const chip = document.createElement('span');
    chip.className = 'experiment-partner-chip';
    chip.dataset.email = email;
    chip.dataset.uid = uid;
    chip.dataset.name = name;

    const isOwner = currentUser && experimentOwnerUid && currentUser.uid === experimentOwnerUid;

    chip.innerHTML = `
        <span class="chip-name">${name || email || '\u05dc\u05d0 \u05e6\u05d5\u05d9\u05df'}</span>
        ${email ? `<span style="font-size:11px; color:#7889a4;">(${email})</span>` : ''}
        <button type="button" class="chip-remove ${isOwner ? '' : 'disabled'}" title="${isOwner ? '\u05d4\u05e1\u05e8\u05ea \u05e9\u05d5\u05ea\u05e3' : '\u05e8\u05e7 \u05de\u05e7\u05d9\u05dd \u05d4\u05e0\u05d9\u05e1\u05d5\u05d9 \u05d9\u05db\u05d5\u05dc \u05dc\u05d4\u05e1\u05d9\u05e8 \u05e9\u05d5\u05ea\u05e4\u05d9\u05dd'}">
            <i class="fas fa-times"></i>
        </button>
    `;

    const removeBtn = chip.querySelector('.chip-remove');
    if (isOwner && removeBtn) {
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!(await confirmDeferredDeletion('\u05d4\u05e9\u05d5\u05ea\u05e3'))) return;
            chip.remove();
        });
    }

    listContainer.appendChild(chip);
}

function collectExperimentPartners() {
    const listContainer = document.getElementById('experiment-partners-list');
    if (!listContainer) return [];

    const partners = [];
    listContainer.querySelectorAll('.experiment-partner-chip').forEach(chip => {
        const name = chip.dataset.name || '';
        const email = chip.dataset.email || '';
        const uid = chip.dataset.uid || '';
        if (name || email) {
            partners.push({ name, email, uid });
        }
    });
    return partners;
}

function initLeadResearcherAutocomplete() {
    const searchInput = document.getElementById('lead-researcher');
    const suggestionsDiv = document.getElementById('lead-researcher-suggestions');

    if (!searchInput || !suggestionsDiv) return;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        suggestionsDiv.innerHTML = '';

        if (!query || query.length < 2) {
            suggestionsDiv.classList.remove('active');
            return;
        }

        const filtered = allUsers.filter(u => {
            return (u.fullName?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query));
        }).slice(0, 8);

        if (!filtered.length) {
            suggestionsDiv.classList.remove('active');
            return;
        }

        filtered.forEach(u => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = '<div class="suggestion-name">' + (u.fullName || '\u2014') + '</div><div class="suggestion-email">' + (u.email || '') + '</div>';
            item.addEventListener('click', () => {
                searchInput.value = u.fullName || u.email || '';
                suggestionsDiv.innerHTML = '';
                suggestionsDiv.classList.remove('active');
                markUserEdited();
            });
            suggestionsDiv.appendChild(item);
        });

        suggestionsDiv.classList.add('active');
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.classList.remove('active');
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstSuggestion = suggestionsDiv.querySelector('.suggestion-item');
            if (firstSuggestion) firstSuggestion.click();
        }
    });
}

function initExperimentPartnersAutocomplete() {
    const searchInput = document.getElementById('experiment-partner-search');
    const suggestionsDiv = document.getElementById('experiment-partner-suggestions');
    const addBtn = document.getElementById('add-experiment-partner');

    if (!searchInput || !suggestionsDiv) return;

    const isOwner = currentUser && experimentOwnerUid && currentUser.uid === experimentOwnerUid;
    if (!isOwner) {
        searchInput.disabled = true;
        searchInput.placeholder = '\u05e8\u05e7 \u05de\u05e7\u05d9\u05dd \u05d4\u05e0\u05d9\u05e1\u05d5\u05d9 \u05d9\u05db\u05d5\u05dc \u05dc\u05d4\u05d5\u05e1\u05d9\u05e3 \u05e9\u05d5\u05ea\u05e4\u05d9\u05dd';
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.classList.add('disabled');
        }
        return;
    }

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        suggestionsDiv.innerHTML = '';
        selectedExperimentPartner = null;

        if (!query || query.length < 2) {
            suggestionsDiv.classList.remove('active');
            return;
        }

        const existingChips = document.querySelectorAll('#experiment-partners-list .experiment-partner-chip');
        const existingUids = new Set();
        const existingEmails = new Set();
        existingChips.forEach(chip => {
            if (chip.dataset.uid) existingUids.add(chip.dataset.uid);
            if (chip.dataset.email) existingEmails.add(chip.dataset.email.toLowerCase());
        });

        const filtered = allUsers.filter(u => {
            if (u.uid === currentUser?.uid) return false;
            if (existingUids.has(u.uid)) return false;
            if (u.email && existingEmails.has(u.email.toLowerCase())) return false;
            return (u.fullName?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query));
        }).slice(0, 8);

        if (!filtered.length) {
            suggestionsDiv.classList.remove('active');
            return;
        }

        filtered.forEach(u => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `
                <div class="suggestion-name">${u.fullName || '\u2014'}</div>
                <div class="suggestion-email">${u.email || ''}</div>
            `;
            item.addEventListener('click', () => {
                selectedExperimentPartner = u;
                searchInput.value = u.fullName || u.email || '';
                suggestionsDiv.innerHTML = '';
                suggestionsDiv.classList.remove('active');
            });
            suggestionsDiv.appendChild(item);
        });

        suggestionsDiv.classList.add('active');
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.classList.remove('active');
        }
    });

    if (addBtn) {
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectedExperimentPartner) {
                if (searchInput.value.trim()) {
                    showToast('\u05e0\u05d0 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e9\u05d5\u05ea\u05e3 \u05de\u05d4\u05e8\u05e9\u05d9\u05de\u05d4', 'warning');
                }
                return;
            }

            addExperimentPartnerChip({
                name: selectedExperimentPartner.fullName || '',
                email: selectedExperimentPartner.email || '',
                uid: selectedExperimentPartner.uid || ''
            });
            markUserEdited();
            showToast(`${selectedExperimentPartner.fullName || selectedExperimentPartner.email} \u05e0\u05d5\u05e1\u05e3 \u05db\u05e9\u05d5\u05ea\u05e3`, 'success');
            searchInput.value = '';
            selectedExperimentPartner = null;
            suggestionsDiv.innerHTML = '';
            suggestionsDiv.classList.remove('active');
        });
    }

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstSuggestion = suggestionsDiv.querySelector('.suggestion-item');
            if (firstSuggestion) firstSuggestion.click();
        }
    });
}

// =========================================
// Creator Field
// =========================================
function populateCreatorField(data) {
    const creatorInput = document.getElementById('experiment-creator');
    if (!creatorInput) return;

    if (data.creatorName) {
        creatorInput.value = data.creatorName;
        return;
    }

    if (experimentOwnerUid && allUsers.length > 0) {
        const ownerUser = allUsers.find(u => u.uid === experimentOwnerUid);
        if (ownerUser) {
            creatorInput.value = ownerUser.fullName || ownerUser.email || '';
            return;
        }
    }

    if (currentUser && experimentOwnerUid === currentUser.uid && userData) {
        creatorInput.value = `${userData.firstName || ''} ${userData.lastName || ''}`.trim();
        return;
    }

    creatorInput.value = '';
}

// =========================================
// Private Until Date Max Enforcement
// =========================================
function enforcePrivateUntilDateMax() {
    const privateUntilInput = document.getElementById('private-until-date');
    if (!privateUntilInput) return;

    const now = getTrustedNow();
    const currentYear = now.getFullYear();
    const maxDateStr = `${currentYear}-04-30`;
    privateUntilInput.setAttribute('max', maxDateStr);

    const todayStr = now.toISOString().slice(0, 10);
    privateUntilInput.setAttribute('min', todayStr);

    if (privateUntilInput.value && privateUntilInput.value > maxDateStr) {
        privateUntilInput.value = maxDateStr;
        showToast(`\u05ea\u05d0\u05e8\u05d9\u05da \u05e1\u05d9\u05d5\u05dd \u05e4\u05e8\u05d8\u05d9\u05d5\u05ea \u05de\u05d5\u05d2\u05d1\u05dc \u05e2\u05d3 30/04/${currentYear} (\u05e1\u05d5\u05e3 \u05e9\u05e0\u05ea \u05d4\u05de\u05d7\u05e7\u05e8)`, 'warning', 5000);
    }

    if (!privateUntilInput.dataset.maxEnforced) {
        privateUntilInput.dataset.maxEnforced = '1';
        privateUntilInput.addEventListener('change', () => {
            const val = privateUntilInput.value;
            if (val) {
                const recalcYear = getTrustedNow().getFullYear();
                const recalcMax = `${recalcYear}-04-30`;
                if (val > recalcMax) {
                    privateUntilInput.value = recalcMax;
                    showToast(`\u05ea\u05d0\u05e8\u05d9\u05da \u05e1\u05d9\u05d5\u05dd \u05e4\u05e8\u05d8\u05d9\u05d5\u05ea \u05de\u05d5\u05d2\u05d1\u05dc \u05e2\u05d3 30/04/${recalcYear} (\u05e1\u05d5\u05e3 \u05e9\u05e0\u05ea \u05d4\u05de\u05d7\u05e7\u05e8)`, 'warning', 5000);
                }
            }
        });
    }
}


// =========================================
// Partners Autocomplete
// =========================================
function initPartnersAutocomplete() {
    const searchInput = document.getElementById('partner-search');
    const suggestionsContainer = document.getElementById('partner-suggestions');
    const addBtn = document.getElementById('add-partner');

    if (!searchInput || !suggestionsContainer) return;

    // בדיקה אם המשתמש הנוכחי הוא הבעלים של הניסוי
    const isOwner = currentUser && experimentOwnerUid && currentUser.uid === experimentOwnerUid;

    // אם המשתמש אינו הבעלים - השבת את האפשרות להוסיף שותפים
    if (!isOwner) {
        searchInput.disabled = true;
        searchInput.placeholder = 'רק מי שהקים/ה את הניסוי יכול/ה להוסיף שותפים';
        searchInput.title = 'רק מי שהקים/ה את הניסוי יכול/ה להוסיף שותפים';
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.classList.add('disabled');
            addBtn.title = 'רק מי שהקים/ה את הניסוי יכול/ה להוסיף שותפים';
        }
        return; // אין צורך להמשיך עם האירועים
    }

    // allUsers כבר נטען ב-onAuthStateChanged
    // אין צורך לטעון שוב כאן

    // Search and filter
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();

        if (query.length < 2) {
            suggestionsContainer.classList.remove('active');
            return;
        }

        const filtered = allUsers.filter(user => {
            // Don't show current user
            if (user.uid === currentUser?.uid) return false;

            // Search in name or email
            const fullName = user.fullName.toLowerCase();
            const email = user.email.toLowerCase();
            return fullName.includes(query) || email.includes(query);
        });

        displaySuggestions(filtered, suggestionsContainer);
    });

    // Add partner button
    if (addBtn) {
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (selectedPartner) {
                addPartnerFromSelection(selectedPartner);
                searchInput.value = '';
                selectedPartner = null;
                suggestionsContainer.classList.remove('active');
            } else if (searchInput.value.trim()) {
                showToast('נא לבצע בחירת שותף מהרשימה', 'warning');
            }
        });
    }

    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
            suggestionsContainer.classList.remove('active');
        }
    });

    // Enter key to select first suggestion
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstSuggestion = suggestionsContainer.querySelector('.suggestion-item');
            if (firstSuggestion) {
                firstSuggestion.click();
            }
        }
    });
}


function displaySuggestions(users, container) {
    if (users.length === 0) {
        container.innerHTML = '<div style="padding: 12px; color: #999; text-align: center;">לא נמצאו תוצאות</div>';
        container.classList.add('active');
        return;
    }

    container.innerHTML = '';
    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `
            <div class="suggestion-name">${user.fullName || user.email}</div>
            <div class="suggestion-email">${user.email}</div>
            <div class="suggestion-role">${user.role || 'לא צוין תפקיד'}</div>
        `;

        item.addEventListener('click', () => {
            selectPartner(user);
        });

        container.appendChild(item);
    });

    container.classList.add('active');
}

function selectPartner(user) {
    // מוסיף ישירות כאשר בוחרים מהרשימה
    addPartnerFromSelection(user);

    const searchInput = document.getElementById('partner-search');
    if (searchInput) {
        searchInput.value = '';
    }

    const suggestionsContainer = document.getElementById('partner-suggestions');
    if (suggestionsContainer) {
        suggestionsContainer.classList.remove('active');
    }

    selectedPartner = null;
}

function addPartnerFromSelection(user) {
    // Check if partner already exists
    const existingPartners = document.querySelectorAll('.partner-row');
    for (const row of existingPartners) {
        if (row.dataset.email === user.email) {
            showToast('שותף זה כבר קיים ברשימה', 'warning');
            return;
        }
    }

    addPartnerRow({
        name: user.fullName || user.email,
        email: user.email
    });

    showToast(`השותף/ה ${user.fullName} נוסף/ה בהצלחה`, 'success');
}

// =========================================
// Events Log (יומן אירועים)
// =========================================
let eventsData = []; // מערך לשמירת אירועים

function initEventsLog() {
    const addEventBtn = document.getElementById('add-event-btn');
    if (addEventBtn) {
        addEventBtn.addEventListener('click', () => openEventModal());
    }

    // Event modal buttons
    document.getElementById('event-modal-cancel')?.addEventListener('click', () => closeModal('event-modal'));
    document.getElementById('event-modal-save')?.addEventListener('click', () => saveEventFromModal());
    initDropzone('event-modal-dropzone', 'event-modal-file', 'event-modal-file-name');

    // טען אירועים קיימים
    loadEvents();
}

function loadEvents() {
    eventsData = experimentData?.events || [];
    renderEventsTable();
}

function renderEventsTable() {
    const tableBody = document.getElementById('events-table-body');
    const container = document.querySelector('.events-table-container');

    if (!tableBody || !container) return;

    tableBody.innerHTML = '';

    if (eventsData.length === 0) {
        container.classList.remove('has-events');
        return;
    }

    container.classList.add('has-events');

    eventsData.forEach((event, index) => {
        const row = createEventRow(event, index);
        tableBody.appendChild(row);
    });
}

function createEventRow(event = {}, index) {
    const row = document.createElement('tr');
    row.dataset.eventIndex = index;

    const today = new Date().toISOString().split('T')[0];

    row.innerHTML = `
        <td data-label="תאריך">
            <input type="date" class="event-date" value="${event.date || today}" data-index="${index}">
        </td>
        <td data-label="תיאור">
            <textarea class="event-description" placeholder="תיאור האירוע..." data-index="${index}">${event.description || ''}</textarea>
        </td>
        <td data-label="קובץ">
            <div class="file-upload-cell">
                ${event.fileUrl ? `
                    <div class="file-info">
                        <i class="fas fa-file"></i>
                        <span class="file-name" title="${event.fileName || 'קובץ'}">${truncateFileName(event.fileName || 'קובץ')}</span>
                        <button type="button" class="btn-file-action btn-download" title="הורד קובץ" data-url="${event.fileUrl}">
                            <i class="fas fa-download"></i>
                        </button>
                        <button type="button" class="btn-file-action btn-delete-file" title="מחק קובץ" data-index="${index}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                ` : `
                    <div class="file-input-wrapper">
                        <button type="button" class="btn-upload-file">
                            <i class="fas fa-upload"></i>
                            <span>בחר קובץ</span>
                        </button>
                        <input type="file" class="event-file-input" data-index="${index}" accept="*/*">
                    </div>
                `}
                <div class="upload-progress" style="display: none;" data-index="${index}">
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: 0%"></div>
                    </div>
                    <span class="progress-text">0%</span>
                </div>
            </div>
        </td>
        <td data-label="פעולות">
            <div class="events-actions">
                <button type="button" class="btn-delete-event" title="מחק אירוע" data-index="${index}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </td>
    `;

    // Event listeners
    const fileInput = row.querySelector('.event-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => handleFileUpload(e, index));
    }

    const downloadBtn = row.querySelector('.btn-download');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const url = downloadBtn.dataset.url;
            if (url) {
                window.open(url, '_blank');
            }
        });
    }

    const deleteFileBtn = row.querySelector('.btn-delete-file');
    if (deleteFileBtn) {
        deleteFileBtn.addEventListener('click', () => deleteEventFile(index));
    }

    const deleteEventBtn = row.querySelector('.btn-delete-event');
    if (deleteEventBtn) {
        deleteEventBtn.addEventListener('click', () => deleteEvent(index));
    }

    // Auto-save on change
    const dateInput = row.querySelector('.event-date');
    const descInput = row.querySelector('.event-description');

    if (dateInput) {
        dateInput.addEventListener('change', () => updateEventData(index));
    }
    if (descInput) {
        descInput.addEventListener('blur', () => updateEventData(index));
    }

    return row;
}

function openEventModal() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('event-modal-date').value = today;
    document.getElementById('event-modal-description').value = '';
    document.getElementById('event-modal-file').value = '';
    document.getElementById('event-modal-file-name').textContent = 'גרירת קובץ לכאן או לחיצה לבחירה (עד 10MB)';
    document.getElementById('event-modal-progress')?.classList.add('hidden');
    openModal('event-modal');
}

async function saveEventFromModal() {
    const date = document.getElementById('event-modal-date').value;
    const description = document.getElementById('event-modal-description').value.trim();
    const fileInput = document.getElementById('event-modal-file');
    const file = fileInput?.files[0];

    if (!date && !description) {
        showToast('יש להזין תאריך או תיאור', 'error');
        return;
    }

    // Check file size
    if (file) {
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            showToast('גודל הקובץ חורג מהמגבלה (10MB מקסימום)', 'error');
            return;
        }
    }

    let fileName = null, fileUrl = null, filePath = null;

    if (file) {
        try {
            const result = await uploadProgressFile(file, 'events', 'event-modal-progress', 'event-modal-progress-fill', 'event-modal-progress-text');
            fileName = file.name;
            fileUrl = result.url;
            filePath = result.path;
        } catch (err) {
            showToast('שגיאה בהעלאת הקובץ: ' + err.message, 'error');
            return;
        }
    }

    eventsData.push({
        date: date,
        description: description,
        fileName: fileName,
        fileUrl: fileUrl,
        filePath: filePath,
        createdAt: new Date().toISOString()
    });

    renderEventsTable();
    closeModal('event-modal');
    showToast('אירוע חדש נוסף בהצלחה', 'success');
}

function updateEventData(index) {
    const row = document.querySelector(`tr[data-event-index="${index}"]`);
    if (!row) return;

    const dateInput = row.querySelector('.event-date');
    const descInput = row.querySelector('.event-description');

    if (eventsData[index]) {
        eventsData[index].date = dateInput?.value || '';
        eventsData[index].description = descInput?.value || '';
    }
}

async function handleFileUpload(e, eventIndex) {
    const file = e.target.files[0];
    if (!file) return;

    if (!permissionsState?.canEdit) {
        showToast('אין הרשאה לקבצים', 'error');
        e.target.value = '';
        return;
    }

    // בדיקת גודל קובץ – מקסימום 10MB (בהתאם ל-Storage Rules)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        showToast('גודל הקובץ חורג מהמגבלה (10MB מקסימום)', 'error');
        e.target.value = '';
        return;
    }

    // יצירת נתיב לקובץ ב-Storage
    // מבנה: users/{userId}/experiments/{experimentId}/events/{timestamp}_{filename}
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `users/${experimentOwnerUid}/experiments/${currentExperimentId}/events/${timestamp}_${safeName}`;

    const storageRef = ref(storage, filePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    // הצג את סרגל ההתקדמות
    const progressContainer = document.querySelector(`.upload-progress[data-index="${eventIndex}"]`);
    const progressBarFill = progressContainer?.querySelector('.progress-bar-fill');
    const progressText = progressContainer?.querySelector('.progress-text');

    if (progressContainer) {
        progressContainer.style.display = 'flex';
    }

    // החבא את כפתור ההעלאה
    const uploadWrapper = document.querySelector(`tr[data-event-index="${eventIndex}"] .file-input-wrapper`);
    if (uploadWrapper) {
        uploadWrapper.style.display = 'none';
    }

    uploadTask.on('state_changed',
        (snapshot) => {
            // התקדמות
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            if (progressBarFill) {
                progressBarFill.style.width = progress + '%';
            }
            if (progressText) {
                progressText.textContent = Math.round(progress) + '%';
            }
        },
        (error) => {
            // שגיאה
            console.error('Upload error:', error);
            showToast('שגיאה בהעלאת הקובץ: ' + error.message, 'error');

            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
            if (uploadWrapper) {
                uploadWrapper.style.display = 'block';
            }
        },
        async () => {
            // הצלחה
            try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

                // עדכן את האירוע עם פרטי הקובץ
                eventsData[eventIndex].fileName = file.name;
                eventsData[eventIndex].fileUrl = downloadURL;
                eventsData[eventIndex].filePath = filePath;

                // רענן את הטבלה
                renderEventsTable();

                showToast('הקובץ הועלה בהצלחה!', 'success');
            } catch (error) {
                console.error('Error getting download URL:', error);
                showToast('שגיאה בקבלת קישור לקובץ', 'error');
            }
        }
    );
}

async function deleteEventFile(eventIndex) {
    const event = eventsData[eventIndex];
    if (!event || !event.filePath) return;

    if (!permissionsState?.canEdit) {
        showToast('אין הרשאה לקבצים', 'error');
        return;
    }

    if (!(await confirmImmediateDeletion('הקובץ'))) return;

    try {
        const storageRef = ref(storage, event.filePath);
        await deleteObject(storageRef);

        // עדכן את האירוע
        eventsData[eventIndex].fileName = null;
        eventsData[eventIndex].fileUrl = null;
        eventsData[eventIndex].filePath = null;

        renderEventsTable();
        showToast('הקובץ נמחק בהצלחה', 'success');
    } catch (error) {
        console.error('Error deleting file:', error);
        // אם הקובץ לא קיים - נקה את הנתונים בכל מקרה
        if (error.code === 'storage/object-not-found') {
            eventsData[eventIndex].fileName = null;
            eventsData[eventIndex].fileUrl = null;
            eventsData[eventIndex].filePath = null;
            renderEventsTable();
        } else {
            showToast('שגיאה במחיקת הקובץ: ' + error.message, 'error');
        }
    }
}

async function deleteEvent(eventIndex) {
    const event = eventsData[eventIndex];

    // Block deletion if a file is still attached
    if (event?.fileUrl) {
        showToast('זוהה קובץ - יש למחוק את הקובץ המצורף לפני מחיקת האירוע', 'error');
        return;
    }

    if (!(await confirmDeferredDeletion('האירוע'))) return;

    // הסר מהמערך
    eventsData.splice(eventIndex, 1);

    renderEventsTable();
    showToast('האירוע נמחק בהצלחה', 'success');
}

function truncateFileName(name, maxLength = 15) {
    if (!name) return 'קובץ';
    if (name.length <= maxLength) return name;

    const ext = name.split('.').pop();
    const baseName = name.substring(0, name.length - ext.length - 1);
    const truncatedBase = baseName.substring(0, maxLength - ext.length - 4);

    return `${truncatedBase}...${ext}`;
}

function collectEventsData() {
    // עדכן את כל השדות לפני איסוף
    eventsData.forEach((_, index) => {
        updateEventData(index);
    });

    return eventsData;
}

// =========================================
// Financial Analysis Log (ניתוחים פיננסים)
// =========================================
let financialData = []; // מערך לשמירת נתונים פיננסיים

function initFinancialLog() {
    const addFinancialBtn = document.getElementById('add-financial-entry-btn');
    if (addFinancialBtn) {
        addFinancialBtn.addEventListener('click', () => openFinancialModal());
    }

    document.getElementById('financial-modal-cancel')?.addEventListener('click', () => closeModal('financial-modal'));
    document.getElementById('financial-modal-save')?.addEventListener('click', () => saveFinancialFromModal());
    initDropzone('financial-modal-dropzone', 'financial-modal-file', 'financial-modal-file-name');

    loadFinancialData();
}

function loadFinancialData() {
    financialData = experimentData?.financialData || [];
    renderFinancialTable();
}

function renderFinancialTable() {
    const tableBody = document.getElementById('financial-table-body');
    const container = document.querySelector('#view-financial-analysis .events-table-container');

    if (!tableBody || !container) return;

    tableBody.innerHTML = '';

    if (financialData.length === 0) {
        container.classList.remove('has-events');
        return;
    }

    container.classList.add('has-events');

    financialData.forEach((entry, index) => {
        const row = createFinancialRow(entry, index);
        tableBody.appendChild(row);
    });
}

function createFinancialRow(entry = {}, index) {
    const row = document.createElement('tr');
    row.dataset.financialIndex = index;

    const today = new Date().toISOString().split('T')[0];

    row.innerHTML = `
        <td data-label="תאריך">
            <input type="date" class="financial-date" value="${entry.date || today}" data-index="${index}">
        </td>
        <td data-label="תיאור">
            <textarea class="financial-description" placeholder="תיאור הנתון..." data-index="${index}">${entry.description || ''}</textarea>
        </td>
        <td data-label="קובץ">
            <div class="file-upload-cell">
                ${entry.fileUrl ? `
                    <div class="file-info">
                        <i class="fas fa-file"></i>
                        <span class="file-name" title="${entry.fileName || 'קובץ'}">${truncateFileName(entry.fileName || 'קובץ')}</span>
                        <button type="button" class="btn-file-action btn-download" title="הורד קובץ" data-url="${entry.fileUrl}">
                            <i class="fas fa-download"></i>
                        </button>
                        <button type="button" class="btn-file-action btn-delete-file" title="מחק קובץ" data-index="${index}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                ` : `
                    <div class="file-input-wrapper">
                        <button type="button" class="btn-upload-file">
                            <i class="fas fa-upload"></i>
                            <span>בחר קובץ</span>
                        </button>
                        <input type="file" class="financial-file-input" data-index="${index}" accept="*/*">
                    </div>
                `}
                <div class="upload-progress" style="display: none;" data-index="${index}">
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: 0%"></div>
                    </div>
                    <span class="progress-text">0%</span>
                </div>
            </div>
        </td>
        <td data-label="פעולות">
            <div class="events-actions">
                <button type="button" class="btn-delete-event" title="מחק נתון" data-index="${index}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </td>
    `;

    const fileInput = row.querySelector('.financial-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => handleFinancialFileUpload(e, index));
    }

    const downloadBtn = row.querySelector('.btn-download');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const url = downloadBtn.dataset.url;
            if (url) {
                window.open(url, '_blank');
            }
        });
    }

    const deleteFileBtn = row.querySelector('.btn-delete-file');
    if (deleteFileBtn) {
        deleteFileBtn.addEventListener('click', () => deleteFinancialFile(index));
    }

    const deleteFinancialBtn = row.querySelector('.btn-delete-event');
    if (deleteFinancialBtn) {
        deleteFinancialBtn.addEventListener('click', () => deleteFinancialEntry(index));
    }

    const dateInput = row.querySelector('.financial-date');
    const descInput = row.querySelector('.financial-description');

    if (dateInput) {
        dateInput.addEventListener('change', () => updateFinancialEntryData(index));
    }
    if (descInput) {
        descInput.addEventListener('blur', () => updateFinancialEntryData(index));
    }

    return row;
}

function openFinancialModal() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('financial-modal-date').value = today;
    document.getElementById('financial-modal-description').value = '';
    document.getElementById('financial-modal-file').value = '';
    document.getElementById('financial-modal-file-name').textContent = 'גרירת קובץ לכאן או לחיצה לבחירה (עד 10MB)';
    document.getElementById('financial-modal-progress')?.classList.add('hidden');
    openModal('financial-modal');
}

async function saveFinancialFromModal() {
    const date = document.getElementById('financial-modal-date').value;
    const description = document.getElementById('financial-modal-description').value.trim();
    const fileInput = document.getElementById('financial-modal-file');
    const file = fileInput?.files[0];

    if (!date && !description) {
        showToast('יש להזין תאריך או תיאור', 'error');
        return;
    }

    if (file) {
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            showToast('גודל הקובץ חורג מהמגבלה (10MB מקסימום)', 'error');
            return;
        }
    }

    let fileName = null, fileUrl = null, filePath = null;

    if (file) {
        try {
            const result = await uploadProgressFile(file, 'financialData', 'financial-modal-progress', 'financial-modal-progress-fill', 'financial-modal-progress-text');
            fileName = file.name;
            fileUrl = result.url;
            filePath = result.path;
        } catch (err) {
            showToast('שגיאה בהעלאת הקובץ: ' + err.message, 'error');
            return;
        }
    }

    financialData.push({
        date,
        description,
        fileName,
        fileUrl,
        filePath,
        createdAt: new Date().toISOString()
    });

    renderFinancialTable();
    closeModal('financial-modal');
    showToast('נתון פיננסי חדש נוסף בהצלחה', 'success');
}

function updateFinancialEntryData(index) {
    const row = document.querySelector(`tr[data-financial-index="${index}"]`);
    if (!row) return;

    const dateInput = row.querySelector('.financial-date');
    const descInput = row.querySelector('.financial-description');

    if (financialData[index]) {
        financialData[index].date = dateInput?.value || '';
        financialData[index].description = descInput?.value || '';
    }
}

async function handleFinancialFileUpload(e, financialIndex) {
    const file = e.target.files[0];
    if (!file) return;

    if (!permissionsState?.canEdit) {
        showToast('אין הרשאה לקבצים', 'error');
        e.target.value = '';
        return;
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        showToast('גודל הקובץ חורג מהמגבלה (10MB מקסימום)', 'error');
        e.target.value = '';
        return;
    }

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `users/${experimentOwnerUid}/experiments/${currentExperimentId}/financialData/${timestamp}_${safeName}`;

    const storageRef = ref(storage, filePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    const progressContainer = document.querySelector(`tr[data-financial-index="${financialIndex}"] .upload-progress[data-index="${financialIndex}"]`);
    const progressBarFill = progressContainer?.querySelector('.progress-bar-fill');
    const progressText = progressContainer?.querySelector('.progress-text');

    if (progressContainer) {
        progressContainer.style.display = 'flex';
    }

    const uploadWrapper = document.querySelector(`tr[data-financial-index="${financialIndex}"] .file-input-wrapper`);
    if (uploadWrapper) {
        uploadWrapper.style.display = 'none';
    }

    uploadTask.on('state_changed',
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            if (progressBarFill) {
                progressBarFill.style.width = progress + '%';
            }
            if (progressText) {
                progressText.textContent = Math.round(progress) + '%';
            }
        },
        (error) => {
            console.error('Upload error:', error);
            showToast('שגיאה בהעלאת הקובץ: ' + error.message, 'error');

            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
            if (uploadWrapper) {
                uploadWrapper.style.display = 'block';
            }
        },
        async () => {
            try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

                financialData[financialIndex].fileName = file.name;
                financialData[financialIndex].fileUrl = downloadURL;
                financialData[financialIndex].filePath = filePath;

                renderFinancialTable();

                showToast('הקובץ הועלה בהצלחה!', 'success');
            } catch (error) {
                console.error('Error getting download URL:', error);
                showToast('שגיאה בקבלת קישור לקובץ', 'error');
            }
        }
    );
}

async function deleteFinancialFile(financialIndex) {
    const entry = financialData[financialIndex];
    if (!entry || !entry.filePath) return;

    if (!permissionsState?.canEdit) {
        showToast('אין הרשאה לקבצים', 'error');
        return;
    }

    if (!(await confirmImmediateDeletion('הקובץ'))) return;

    try {
        const storageRef = ref(storage, entry.filePath);
        await deleteObject(storageRef);

        financialData[financialIndex].fileName = null;
        financialData[financialIndex].fileUrl = null;
        financialData[financialIndex].filePath = null;

        renderFinancialTable();
        showToast('הקובץ נמחק בהצלחה', 'success');
    } catch (error) {
        console.error('Error deleting file:', error);
        if (error.code === 'storage/object-not-found') {
            financialData[financialIndex].fileName = null;
            financialData[financialIndex].fileUrl = null;
            financialData[financialIndex].filePath = null;
            renderFinancialTable();
        } else {
            showToast('שגיאה במחיקת הקובץ: ' + error.message, 'error');
        }
    }
}

async function deleteFinancialEntry(financialIndex) {
    const entry = financialData[financialIndex];

    if (entry?.fileUrl) {
        showToast('זוהה קובץ - יש למחוק את הקובץ המצורף לפני מחיקת הנתון', 'error');
        return;
    }

    if (!(await confirmDeferredDeletion('הנתון הפיננסי'))) return;

    financialData.splice(financialIndex, 1);

    renderFinancialTable();
    showToast('הנתון הפיננסי נמחק בהצלחה', 'success');
}

function collectFinancialData() {
    financialData.forEach((_, index) => {
        updateFinancialEntryData(index);
    });

    return financialData;
}

// =========================================
// Soil Treatment – Dynamic Tables
// =========================================

function renderSoilTable(tbodyId, rows, fields) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    rows.forEach(row => addSoilTableRow(tbody, fields, row));
}

function addSoilTableRow(tbody, fields, data = {}) {
    const labels = { date: 'תאריך', amount: 'כמות', method: 'אופן יישום' };
    const tr = document.createElement('tr');
    fields.forEach(field => {
        const td = document.createElement('td');
        td.dataset.label = labels[field] || field;
        if (field === 'date') {
            const inp = document.createElement('input');
            inp.type = 'date';
            inp.className = 'soil-input';
            inp.dataset.field = field;
            inp.value = data[field] || '';
            td.appendChild(inp);
        } else {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'soil-input';
            inp.dataset.field = field;
            inp.value = data[field] || '';
            inp.placeholder = field === 'amount' ? 'כמות' : 'אופן יישום';
            td.appendChild(inp);
        }
        tr.appendChild(td);
    });
    // Delete button cell
    const tdDel = document.createElement('td');
    tdDel.dataset.label = '';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-del-soil-row';
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', async () => {
        if (!(await confirmDeferredDeletion('השורה'))) return;
        tr.remove();
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);
    wireProgressRowConditionalLogic(tr);
    tbody.appendChild(tr);
}

function updateAgroActionOtherRowVisibility(row) {
    const actionSelect = row.querySelector('[data-field="action"]');
    const otherInput = row.querySelector('[data-field="actionOther"]');
    if (!actionSelect || !otherInput) return;
    const otherCell = otherInput.closest('td');
    const shouldShow = actionSelect.value === 'אחר';
    if (otherCell) otherCell.style.display = shouldShow ? '' : 'none';
    if (!shouldShow) otherInput.value = '';
}

function updateInoculationMethodRowVisibility(row) {
    const typeSelect = row.querySelector('[data-field="inoculationType"]');
    const methodSelect = row.querySelector('[data-field="inoculationMethod"]');
    if (!typeSelect || !methodSelect) return;
    const methodCell = methodSelect.closest('td');
    const shouldShow = typeSelect.value === 'מלאכותי';
    if (methodCell) methodCell.style.display = shouldShow ? '' : 'none';
    if (!shouldShow) methodSelect.value = '';
}

function wireProgressRowConditionalLogic(row) {
    const actionSelect = row.querySelector('[data-field="action"]');
    if (actionSelect) {
        actionSelect.addEventListener('change', () => updateAgroActionOtherRowVisibility(row));
        updateAgroActionOtherRowVisibility(row);
    }

    const inoculationTypeSelect = row.querySelector('[data-field="inoculationType"]');
    if (inoculationTypeSelect) {
        inoculationTypeSelect.addEventListener('change', () => updateInoculationMethodRowVisibility(row));
        updateInoculationMethodRowVisibility(row);
    }
}

function renderSoilDisinfectTable(tbodyId, rows) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    rows.forEach(row => addSoilDisinfectRow(tbody, row));
}

function addSoilDisinfectRow(tbody, data = {}) {
    registerDynamicOption('soilDisinfectionMaterial', data.material);

    const fields = ['date','material','amount','method'];
    const labels = { date: 'תאריך', material: 'חומר החיטוי', amount: 'כמות', method: 'אופן יישום' };
    const placeholders = { date: '', material: 'חומר החיטוי', amount: 'כמות', method: 'אופן יישום' };
    const tr = document.createElement('tr');
    fields.forEach(field => {
        const td = document.createElement('td');
        td.dataset.label = labels[field] || field;
        const inp = document.createElement('input');
        inp.type = field === 'date' ? 'date' : 'text';
        inp.className = 'soil-input';
        inp.dataset.field = field;
        inp.value = data[field] || '';
        if (field === 'material') {
            inp.setAttribute('list', 'datalist-soil-disinfection-material');
        }
        if (placeholders[field]) inp.placeholder = placeholders[field];
        td.appendChild(inp);
        tr.appendChild(td);
    });
    const tdDel = document.createElement('td');
    tdDel.dataset.label = '';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-del-soil-row';
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', async () => {
        if (!(await confirmDeferredDeletion('השורה'))) return;
        tr.remove();
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
}

function collectSoilTableRows(tbodyId, fields) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll('tr').forEach(tr => {
        const obj = {};
        fields.forEach(field => {
            const inp = tr.querySelector(`[data-field="${field}"]`);
            obj[field] = inp ? inp.value : '';
        });
        rows.push(obj);
    });
    return rows;
}

function collectSoilDisinfectRows(tbodyId) {
    return collectSoilTableRows(tbodyId, ['date','material','amount','method']);
}

function initSoilTableListeners() {
    const compostTbody = document.getElementById('compost-tbody');
    const disinfectTbody = document.getElementById('disinfect-tbody');
    const SOIL_LABELS = { date: 'תאריך', amount: 'כמות', method: 'אופן יישום', material: 'חומר החיטוי' };

    // Compost – popup modal (spec: פופ אפ)
    document.getElementById('add-compost-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת פיזור קומפוסט',
            fields: ['date', 'amount', 'method'],
            labels: SOIL_LABELS,
            onSave: (data) => addSoilTableRow(compostTbody, ['date', 'amount', 'method'], data)
        })
    );

    // Soil disinfection – popup modal (spec: פופ אפ)
    document.getElementById('add-disinfect-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת חיטוי קרקע',
            fields: ['date', 'material', 'amount', 'method'],
            labels: SOIL_LABELS,
            dynamicDatalists: { material: 'datalist-soil-disinfection-material' },
            onSave: (data) => addSoilDisinfectRow(disinfectTbody, data)
        })
    );
}

// =========================================
// Progress Views – Default Row Data
// =========================================
const DEFAULT_GROWTH_ROWS = [
    'קצב צימוח (גובה)', 'עובי הגבעול', 'מספר פרחים בתפרחת', 'מספר חנטים',
    'LAI', 'מוליכות פיוניות', 'SPAD', 'פוטוסינתזה', 'ביומסה - רטוב', 'ביומסה - יבש'
];

const DEFAULT_CLIMATE_ROWS = [
    { name: 'טמפרטורה', location: 'חממה' },
    { name: 'לחות יחסית', location: 'חממה' },
    { name: 'לחץ אדים', location: 'חממה' },
    { name: 'מהירות רוח', location: 'חממה' },
    { name: 'כיוון רוח', location: 'חממה' },
    { name: 'מהירות רוח רגעית', location: '' },
    { name: 'קרינה PAR', location: 'חממה' },
    { name: 'קרינה נטו', location: 'חממה' },
    { name: 'רטיבות נפחית', location: 'קרקע' },
    { name: 'טמפרטורה', location: 'קרקע' },
    { name: 'מוליכות חשמלית', location: 'קרקע' },
    { name: 'טנסיומטרים', location: 'קרקע' },
    { name: 'פוטנציאל מים בקרקע', location: 'קרקע' },
    { name: 'EC', location: 'קרקע' },
    { name: 'PH', location: 'קרקע' }
];

const DEFAULT_AGRO_ROWS = ['שוצים', 'הדליות', 'עישוב', 'גיזום', 'עקירה'];

// =========================================
// Progress Views – Generic Row Builder
// =========================================
function addProgressRow(tbody, fields, labels, data, options) {
    if (!tbody) return;
    data = data || {};
    options = options || {};
    const tr = document.createElement('tr');

    // Store file metadata on row if provided
    if (data.fileUrl) tr.dataset.fileUrl = data.fileUrl;
    if (data.filePath) tr.dataset.filePath = data.filePath;

    fields.forEach(field => {
        const td = document.createElement('td');
        td.dataset.label = labels[field] || field;

        // For 'fileName' field
        if (field === 'fileName') {
            if (options.enableFileUpload) {
                renderProgressFileCell(td, tr, data, labels, field, options.uploadFolder || 'files');
            } else if (data.fileUrl) {
                td.innerHTML = `
                    <div class="progress-file-info">
                        <i class="fas fa-file"></i>
                        <span class="progress-file-name" title="${data.fileName || ''}">${data.fileName || ''}</span>
                        <button type="button" class="btn-file-action btn-download" title="הורדת קובץ" data-url="${data.fileUrl}">
                            <i class="fas fa-download"></i>
                        </button>
                        <button type="button" class="btn-file-action btn-delete-progress-file" title="מחיקת קובץ">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                const hiddenInp = document.createElement('input');
                hiddenInp.type = 'hidden';
                hiddenInp.dataset.field = field;
                hiddenInp.value = data.fileName || '';
                td.appendChild(hiddenInp);

                td.querySelector('.btn-download')?.addEventListener('click', (e) => {
                    const url = e.currentTarget.dataset.url;
                    if (url) window.open(url, '_blank');
                });

                td.querySelector('.btn-delete-progress-file')?.addEventListener('click', async () => {
                    const filePath = tr.dataset.filePath;
                    if (!filePath) return;
                    if (!(await confirmImmediateDeletion('הקובץ'))) return;
                    const sectionId = getSectionIdByView();
                    const shouldDeletePhysicalFile = !sectionId || !isFilePathSharedAcrossTreatments(sectionId, filePath);
                    try {
                        if (shouldDeletePhysicalFile) {
                            const storageRef = ref(storage, filePath);
                            await deleteObject(storageRef);
                            showToast('הקובץ נמחק בהצלחה', 'success');
                        } else {
                            showToast('הקובץ נותק מהרשומה הנוכחית בלבד (קיים גם בטיפול נוסף)', 'info');
                        }
                    } catch (err) {
                        if (err.code !== 'storage/object-not-found') {
                            showToast('שגיאה במחיקת הקובץ: ' + err.message, 'error');
                            return;
                        }
                    }
                    delete tr.dataset.fileUrl;
                    delete tr.dataset.filePath;
                    td.innerHTML = '';
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.className = 'soil-input';
                    inp.dataset.field = field;
                    inp.value = data.fileName || '';
                    inp.placeholder = labels[field] || '';
                    td.appendChild(inp);
                });
            } else {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'soil-input';
                inp.dataset.field = field;
                inp.value = data[field] || '';
                if (labels[field]) inp.placeholder = labels[field];
                td.appendChild(inp);
            }
        } else {
            // Normal input
            const isReadonly = options.readonlyFields && options.readonlyFields.includes(field) && data[field];
            const fieldOptions = options.fieldOptions && options.fieldOptions[field];

            if (fieldOptions && Array.isArray(fieldOptions)) {
                const select = document.createElement('select');
                select.className = 'soil-input';
                select.dataset.field = field;

                const selectOptions = normalizeUniqueValues([
                    ...fieldOptions,
                    ...(data[field] !== undefined && data[field] !== null && String(data[field]).trim() ? [String(data[field]).trim()] : [])
                ]);

                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = `בחירת ${labels[field] || field}`;
                select.appendChild(emptyOpt);

                selectOptions.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.textContent = opt;
                    select.appendChild(option);
                });

                select.value = data[field] || '';
                if (isReadonly) {
                    select.disabled = true;
                    select.style.fontWeight = '600';
                }
                td.appendChild(select);
            } else {
                // Auto-detect input type: date fields → calendar, number fields → numeric
                let inputType = 'text';
                if (options.inputTypes && options.inputTypes[field]) {
                    inputType = options.inputTypes[field];
                } else if (field === 'date' || field.endsWith('Date')) {
                    inputType = 'date';
                } else if (['hours','workers','dosage','quantity','fruitFloor','damageValue','totalWater','totalFert'].includes(field)) {
                    inputType = 'number';
                }
                const inp = document.createElement('input');
                inp.type = inputType;
                if (inputType === 'number') inp.step = 'any';
                inp.className = 'soil-input';
                inp.dataset.field = field;
                inp.value = data[field] || '';
                const fieldDatalist = options.dynamicDatalists && options.dynamicDatalists[field];
                if (fieldDatalist && inputType === 'text') {
                    inp.setAttribute('list', fieldDatalist);
                }
                if (labels[field]) inp.placeholder = labels[field];
                if (isReadonly) { inp.readOnly = true; inp.style.fontWeight = '600'; }
                td.appendChild(inp);
            }
        }
        tr.appendChild(td);
    });

    // Delete row button
    const tdDel = document.createElement('td');
    tdDel.dataset.label = '';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-del-soil-row';
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', async () => {
        // Block deletion if a file is still attached
        if (tr.dataset.fileUrl) {
            showToast('זוהה קובץ - יש למחוק את הקובץ המצורף לפני מחיקת השורה', 'error');
            return;
        }
        if (!(await confirmDeferredDeletion('השורה'))) return;
        tr.remove();
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
}

function renderProgressFileCell(td, tr, data, labels, field, uploadFolder) {
    const renderEmptyState = () => {
        td.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'file-input-wrapper';

        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'btn-upload-file';
        uploadBtn.innerHTML = '<i class="fas fa-upload"></i><span>בחירת קובץ</span>';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '*/*';
        fileInput.className = 'event-file-input';
        fileInput.style.display = 'none';

        const hiddenInp = document.createElement('input');
        hiddenInp.type = 'hidden';
        hiddenInp.dataset.field = field;
        hiddenInp.value = '';

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const selectedFile = fileInput.files && fileInput.files[0];
            if (!selectedFile) return;

            // בדיקת גודל קובץ – מקסימום 10MB
            const MAX_FILE_SIZE = 10 * 1024 * 1024;
            if (selectedFile.size > MAX_FILE_SIZE) {
                showToast('גודל הקובץ חורג מהמגבלה (10MB מקסימום)', 'error');
                fileInput.value = '';
                return;
            }

            uploadBtn.disabled = true;
            uploadBtn.querySelector('span').textContent = 'העלאה...';
            try {
                const result = await uploadProgressFile(selectedFile, uploadFolder);
                tr.dataset.fileUrl = result.url;
                tr.dataset.filePath = result.path;
                hiddenInp.value = selectedFile.name;
                data.fileName = selectedFile.name;
                renderFileState(selectedFile.name);
                showToast('הקובץ הועלה בהצלחה', 'success');
            } catch (err) {
                showToast('שגיאה בהעלאת הקובץ: ' + err.message, 'error');
                uploadBtn.disabled = false;
                uploadBtn.querySelector('span').textContent = 'בחירת קובץ';
            }
        });

        wrapper.appendChild(uploadBtn);
        wrapper.appendChild(fileInput);
        td.appendChild(wrapper);
        td.appendChild(hiddenInp);
    };

    const renderFileState = (fileDisplayName) => {
        td.innerHTML = `
            <div class="progress-file-info">
                <i class="fas fa-file"></i>
                <span class="progress-file-name" title="${fileDisplayName || ''}">${fileDisplayName || ''}</span>
                <button type="button" class="btn-file-action btn-download" title="הורדת קובץ" data-url="${tr.dataset.fileUrl || ''}">
                    <i class="fas fa-download"></i>
                </button>
                <button type="button" class="btn-file-action btn-delete-progress-file" title="מחיקת קובץ">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        const hiddenInp = document.createElement('input');
        hiddenInp.type = 'hidden';
        hiddenInp.dataset.field = field;
        hiddenInp.value = fileDisplayName || '';
        td.appendChild(hiddenInp);

        td.querySelector('.btn-download')?.addEventListener('click', (e) => {
            const url = e.currentTarget.dataset.url;
            if (url) window.open(url, '_blank');
        });

        td.querySelector('.btn-delete-progress-file')?.addEventListener('click', async () => {
            const filePath = tr.dataset.filePath;
            if (!filePath) return;
            if (!(await confirmImmediateDeletion('הקובץ'))) return;
            const sectionId = getSectionIdByView();
            const shouldDeletePhysicalFile = !sectionId || !isFilePathSharedAcrossTreatments(sectionId, filePath);
            try {
                if (shouldDeletePhysicalFile) {
                    await deleteObject(ref(storage, filePath));
                    showToast('הקובץ נמחק בהצלחה', 'success');
                } else {
                    showToast('הקובץ נותק מהרשומה הנוכחית בלבד (קיים גם בטיפול נוסף)', 'info');
                }
            } catch (err) {
                if (err.code !== 'storage/object-not-found') {
                    showToast('שגיאה במחיקת הקובץ: ' + err.message, 'error');
                    return;
                }
            }

            delete tr.dataset.fileUrl;
            delete tr.dataset.filePath;
            data.fileName = '';
            renderEmptyState();
        });
    };

    if (data.fileUrl && data.fileName) {
        tr.dataset.fileUrl = data.fileUrl;
        if (data.filePath) tr.dataset.filePath = data.filePath;
        renderFileState(data.fileName);
    } else {
        renderEmptyState();
    }
}

function collectProgressRows(tbodyId, fields) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll('tr').forEach(tr => {
        const obj = {};
        fields.forEach(field => {
            const inp = tr.querySelector(`[data-field="${field}"]`);
            obj[field] = inp ? inp.value : '';
        });
        // Include file metadata if present
        if (tr.dataset.fileUrl) obj.fileUrl = tr.dataset.fileUrl;
        if (tr.dataset.filePath) obj.filePath = tr.dataset.filePath;
        rows.push(obj);
    });
    return rows;
}

function normalizeLegacyRangeDates(row = {}) {
    const normalized = { ...row };
    const hasStart = Boolean(normalized.startDate);
    const hasEnd = Boolean(normalized.endDate);
    if (hasStart || hasEnd) return normalized;

    const legacy = String(normalized.measureDates || '').trim();
    if (!legacy) return normalized;

    const isoDates = legacy.match(/\d{4}-\d{2}-\d{2}/g) || [];
    if (isoDates.length >= 2) {
        normalized.startDate = isoDates[0];
        normalized.endDate = isoDates[1];
    } else if (isoDates.length === 1) {
        normalized.startDate = isoDates[0];
        normalized.endDate = isoDates[0];
    }

    return normalized;
}

// =========================================
// Irrigation & Fertilization
// =========================================
const IRRIGATION_FIELDS = ['fileName','uploadDate','startDate','endDate','totalWater'];
const IRRIGATION_LABELS = { fileName:'שם הקובץ', uploadDate:'תאריך העלאה', startDate:'תאריך התחלה', endDate:'תאריך סיום', totalWater:'סה"כ כמות מים (ליטר)' };
const FERTILIZATION_FIELDS = ['fileName','uploadDate','startDate','endDate','fertType','company','totalFert'];
const FERTILIZATION_LABELS = { fileName:'שם הקובץ', uploadDate:'תאריך העלאה', startDate:'תאריך התחלה', endDate:'תאריך סיום', fertType:'סוג הדשן', company:'חברה', totalFert:'סה"כ כמות דשן' };
const FERTILIZATION_DYNAMIC_DATALISTS = { fertType: 'datalist-fertilizer-type', company: 'datalist-fertilizer-company' };

// =========================================
// Growth
// =========================================
const GROWTH_FIELDS = ['name','value','measureDate'];
const GROWTH_LABELS = { name:'נתון', value:'ערך', measureDate:'תאריך מדידה' };

function renderGrowthTable(rows) {
    const tbody = document.getElementById('growth-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (rows && rows.length > 0) {
        rows.forEach(row => addProgressRow(tbody, GROWTH_FIELDS, GROWTH_LABELS, row, { readonlyFields: ['name'] }));
    }
}

// =========================================
// Climate
// =========================================
const CLIMATE_FIELDS = ['name','location','sensorPosition','sensorDepth','startDate','endDate','fileName','notes'];
const CLIMATE_LABELS = { name:'נתון', location:'מיקום מדידה', sensorPosition:'מיקום חיישן במרחב', sensorDepth:'גובה/עומק חיישן', startDate:'תאריך התחלה', endDate:'תאריך סיום', fileName:'קובץ מצורף', notes:'הערות' };
const CLIMATE_NAME_OPTIONS = [...new Set(DEFAULT_CLIMATE_ROWS.map(item => item.name))];
const CLIMATE_LOCATION_OPTIONS = ['חממה', 'קרקע'];

function renderClimateTable(rows) {
    const tbody = document.getElementById('climate-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    (rows || []).forEach(row => addProgressRow(
        tbody,
        CLIMATE_FIELDS,
        CLIMATE_LABELS,
        normalizeLegacyRangeDates(row),
        {
            fieldOptions: {
                name: CLIMATE_NAME_OPTIONS,
                location: CLIMATE_LOCATION_OPTIONS
            },
            enableFileUpload: true,
            uploadFolder: 'climate'
        }
    ));
}

// =========================================
// Agrotechnics
// =========================================
const AGRO_FIELDS = ['action','actionOther','actionDate','hours','workers'];
const AGRO_LABELS = { action:'פעולה', actionOther:'פירוט פעולה', actionDate:'תאריך ביצוע הפעולה', hours:'כמות שעות לפעולה', workers:'כמות עובדים לפעולה' };
const AGRO_ACTION_OPTIONS = ['שוצים', 'הדליות', 'עישוב', 'גיזום', 'עקירה', 'אחר'];

function renderAgroTable(rows) {
    const tbody = document.getElementById('agro-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    (rows || []).forEach(row => addProgressRow(tbody, AGRO_FIELDS, AGRO_LABELS, row, { fieldOptions: { action: AGRO_ACTION_OPTIONS } }));
}

// =========================================
// Plant Protection
// =========================================
const PEST_FIELDS = ['pest','date','inoculationType','inoculationMethod','inoculationAmount','notes'];
const PEST_LABELS = {
    pest:'מפגע',
    date:'תאריך',
    inoculationType:'סוג האילוח',
    inoculationMethod:'שיטת האילוח',
    inoculationAmount:'כמות האילוח',
    notes:'הערות'
};
const PROTECTION_FIELDS = ['material','date','dosage','combined','notes'];
const PROTECTION_LABELS = { material:'חומר', date:'תאריך', dosage:'מינון לטיפול', combined:'משולב עם חומרים נוספים', notes:'הערות' };

function addPestRow(tbodyId, data) {
    addProgressRow(document.getElementById(tbodyId), PEST_FIELDS, PEST_LABELS, data || {}, {
        fieldOptions: {
            inoculationType: ['טבעי', 'מלאכותי'],
            inoculationMethod: ['ערבוב בקרקע', 'ריסוס', 'שחרור (חרקים)', 'טבילה', 'שפשוף', 'דקירה', 'אחר']
        }
    });
}
function addProtectionRow(tbodyId, data) {
    registerDynamicOption('plantProtectionMaterial', data?.material);

    addProgressRow(document.getElementById(tbodyId), PROTECTION_FIELDS, PROTECTION_LABELS, data || {}, {
        fieldOptions: {
            combined: ['לא', 'כן']
        },
        dynamicDatalists: {
            material: 'datalist-plant-protection-material'
        }
    });
}

// =========================================
// Yield
// =========================================
const YIELD_MEASURE_FIELDS = ['measureDate','repeatCount','fruitFloor','quality','quantity','fruitDesc','notes'];
const YIELD_MEASURE_LABELS = { measureDate:'תאריך מדידה', repeatCount:'חזרה', fruitFloor:'קומת הפרי', quality:'איכות (לק"ג)', quantity:'כמות (ק"ג)', fruitDesc:'תיאור הפרי', notes:'הערות' };
const YIELD_DAMAGE_FIELDS = ['measureDate','repeatCount','damage','damageIndex','damageValue','damageDesc'];
const YIELD_DAMAGE_LABELS = { measureDate:'תאריך מדידה', repeatCount:'חזרה', damage:'הפגע הנמדד', damageIndex:'מדד נזק (%/ס"מ/No.)', damageValue:'ערך הנזק', damageDesc:'תיאור הנזק' };

function addYieldMeasureRow(data) {
    addProgressRow(document.getElementById('yield-measure-tbody'), YIELD_MEASURE_FIELDS, YIELD_MEASURE_LABELS, data || {}, {
        fieldOptions: {
            repeatCount: getYieldRepeatOptionsForTreatment(),
            quality: ['מובחר', "סוג א'", "סוג ב'", "סוג ג'"]
        }
    });
}
function addYieldDamageRow(data) {
    addProgressRow(document.getElementById('yield-damage-tbody'), YIELD_DAMAGE_FIELDS, YIELD_DAMAGE_LABELS, data || {}, {
        fieldOptions: {
            repeatCount: getYieldRepeatOptionsForTreatment(),
            damageIndex: ['%', 'ס"מ', 'No.']
        }
    });
}

// =========================================
// Progress Views – Populate
// =========================================
function populateProgressViews(data) {
    // Irrigation
    const irrigTbody = document.getElementById('irrigation-tbody');
    if (irrigTbody) {
        irrigTbody.innerHTML = '';
        (data.irrigationData || []).forEach(r => addProgressRow(irrigTbody, IRRIGATION_FIELDS, IRRIGATION_LABELS, normalizeLegacyRangeDates(r)));
    }
    // Fertilization
    const fertTbody = document.getElementById('fertilization-tbody');
    if (fertTbody) {
        fertTbody.innerHTML = '';
        (data.fertilizationData || []).forEach(r => addProgressRow(fertTbody, FERTILIZATION_FIELDS, FERTILIZATION_LABELS, normalizeLegacyRangeDates(r), {
            dynamicDatalists: FERTILIZATION_DYNAMIC_DATALISTS
        }));
    }
    // Growth, Climate, Agro – use their render functions (handle defaults)
    renderGrowthTable(data.growthData);
    renderClimateTable(data.climateData);
    renderAgroTable(data.agrotechnicsData);
    // Plant Protection
    const pp = data.plantProtectionData || {};
    const pestTbody = document.getElementById('pest-tbody');
    if (pestTbody) { pestTbody.innerHTML = ''; (pp.pests || []).forEach(r => addPestRow('pest-tbody', r)); }
    const diseaseTbody = document.getElementById('disease-tbody');
    if (diseaseTbody) { diseaseTbody.innerHTML = ''; (pp.diseases || []).forEach(r => addPestRow('disease-tbody', r)); }
    const sprayProtTbody = document.getElementById('spray-prot-tbody');
    if (sprayProtTbody) { sprayProtTbody.innerHTML = ''; (pp.sprays || []).forEach(r => addProtectionRow('spray-prot-tbody', r)); }
    const drenchTbody = document.getElementById('drench-tbody');
    if (drenchTbody) { drenchTbody.innerHTML = ''; (pp.drenches || []).forEach(r => addProtectionRow('drench-tbody', r)); }
    // Yield
    const yd = getYieldDataForTreatment(data, currentTreatmentIndex);
    const ymTbody = document.getElementById('yield-measure-tbody');
    if (ymTbody) { ymTbody.innerHTML = ''; (yd.measures || []).forEach(r => addYieldMeasureRow(r)); }
    const ydTbody = document.getElementById('yield-damage-tbody');
    if (ydTbody) { ydTbody.innerHTML = ''; (yd.damages || []).forEach(r => addYieldDamageRow(r)); }
}

// =========================================
// Progress Views – Collect
// =========================================
function collectProgressData() {
    return {
        irrigationData: collectProgressRows('irrigation-tbody', IRRIGATION_FIELDS),
        fertilizationData: collectProgressRows('fertilization-tbody', FERTILIZATION_FIELDS),
        growthData: collectProgressRows('growth-tbody', GROWTH_FIELDS),
        climateData: collectProgressRows('climate-tbody', CLIMATE_FIELDS),
        agrotechnicsData: collectProgressRows('agro-tbody', AGRO_FIELDS),
        plantProtectionData: {
            pests: collectProgressRows('pest-tbody', PEST_FIELDS),
            diseases: collectProgressRows('disease-tbody', PEST_FIELDS),
            sprays: collectProgressRows('spray-prot-tbody', PROTECTION_FIELDS),
            drenches: collectProgressRows('drench-tbody', PROTECTION_FIELDS)
        },
        yieldData: {
            measures: collectProgressRows('yield-measure-tbody', YIELD_MEASURE_FIELDS),
            damages: collectProgressRows('yield-damage-tbody', YIELD_DAMAGE_FIELDS)
        }
    };
}

// =========================================
// Progress Views – Init Listeners
// =========================================
function initProgressListeners() {
    // Irrigation & Fertilization – open modals
    document.getElementById('add-irrigation-row')?.addEventListener('click', () => openIrrigationModal());
    document.getElementById('add-fertilization-row')?.addEventListener('click', () => openFertilizationModal());
    // Growth – open modal
    document.getElementById('add-growth-row')?.addEventListener('click', () => openGrowthModal());

    // Climate – popup modal (spec: פופ אפ)
    document.getElementById('add-climate-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת נתון אקלים חדש',
            fields: CLIMATE_FIELDS,
            labels: CLIMATE_LABELS,
            skipFields: ['fileName'],
            fieldOptions: { name: CLIMATE_NAME_OPTIONS, location: CLIMATE_LOCATION_OPTIONS },
            onSave: (data) => addProgressRow(document.getElementById('climate-tbody'), CLIMATE_FIELDS, CLIMATE_LABELS, data, {
                fieldOptions: { name: CLIMATE_NAME_OPTIONS, location: CLIMATE_LOCATION_OPTIONS },
                enableFileUpload: true,
                uploadFolder: 'climate'
            })
        })
    );

    // Agrotechnics – popup modal (spec: פופ אפ)
    document.getElementById('add-agro-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת פעולה חדשה',
            fields: AGRO_FIELDS,
            labels: AGRO_LABELS,
            fieldOptions: { action: AGRO_ACTION_OPTIONS },
            onSave: (data) => addProgressRow(document.getElementById('agro-tbody'), AGRO_FIELDS, AGRO_LABELS, data, {
                fieldOptions: { action: AGRO_ACTION_OPTIONS }
            })
        })
    );

    // Pests – popup modal (spec: פופ אפ)
    document.getElementById('add-pest-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת מזיק חדש',
            fields: PEST_FIELDS,
            labels: PEST_LABELS,
            fieldOptions: {
                inoculationType: ['טבעי', 'מלאכותי'],
                inoculationMethod: ['ערבוב בקרקע', 'ריסוס', 'שחרור (חרקים)', 'טבילה', 'שפשוף', 'דקירה', 'אחר']
            },
            onSave: (data) => addPestRow('pest-tbody', data)
        })
    );

    // Diseases – popup modal (spec: פופ אפ)
    document.getElementById('add-disease-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת מחלה חדשה',
            fields: PEST_FIELDS,
            labels: PEST_LABELS,
            fieldOptions: {
                inoculationType: ['טבעי', 'מלאכותי'],
                inoculationMethod: ['ערבוב בקרקע', 'ריסוס', 'שחרור (חרקים)', 'טבילה', 'שפשוף', 'דקירה', 'אחר']
            },
            onSave: (data) => addPestRow('disease-tbody', data)
        })
    );

    // Sprays – popup modal (spec: פופ אפ)
    document.getElementById('add-spray-prot-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת ריסוס חדש',
            fields: PROTECTION_FIELDS,
            labels: PROTECTION_LABELS,
            fieldOptions: { combined: ['לא', 'כן'] },
            dynamicDatalists: { material: 'datalist-plant-protection-material' },
            onSave: (data) => addProtectionRow('spray-prot-tbody', data)
        })
    );

    // Drenches – popup modal (spec: פופ אפ)
    document.getElementById('add-drench-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת הגמעה חדשה',
            fields: PROTECTION_FIELDS,
            labels: PROTECTION_LABELS,
            fieldOptions: { combined: ['לא', 'כן'] },
            dynamicDatalists: { material: 'datalist-plant-protection-material' },
            onSave: (data) => addProtectionRow('drench-tbody', data)
        })
    );

    // Yield Measure – popup modal (spec: פופ אפ)
    document.getElementById('add-yield-measure-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת מדידה חדשה',
            fields: YIELD_MEASURE_FIELDS,
            labels: YIELD_MEASURE_LABELS,
            fieldOptions: {
                repeatCount: getYieldRepeatOptionsForTreatment(),
                quality: ['מובחר', "סוג א'", "סוג ב'", "סוג ג'"]
            },
            onSave: (data) => addYieldMeasureRow(data)
        })
    );

    // Yield Damage – popup modal (spec: פופ אפ)
    document.getElementById('add-yield-damage-row')?.addEventListener('click', () =>
        openGenericRowModal({
            title: 'הוספת פגע חדש',
            fields: YIELD_DAMAGE_FIELDS,
            labels: YIELD_DAMAGE_LABELS,
            fieldOptions: {
                repeatCount: getYieldRepeatOptionsForTreatment(),
                damageIndex: ['%', 'ס"מ', 'No.']
            },
            onSave: (data) => addYieldDamageRow(data)
        })
    );

    // Modal buttons – existing modals
    document.getElementById('irr-modal-cancel')?.addEventListener('click', () => closeModal('irrigation-file-modal'));
    document.getElementById('irr-modal-save')?.addEventListener('click', () => saveIrrigationFile());
    document.getElementById('fert-modal-cancel')?.addEventListener('click', () => closeModal('fertilization-file-modal'));
    document.getElementById('fert-modal-save')?.addEventListener('click', () => saveFertilizationFile());
    document.getElementById('growth-modal-cancel')?.addEventListener('click', () => closeModal('growth-data-modal'));
    document.getElementById('growth-modal-save')?.addEventListener('click', () => saveGrowthData());
    document.getElementById('growth-modal-name')?.addEventListener('change', () => {
        const nameSelect = document.getElementById('growth-modal-name');
        const customRow = document.getElementById('growth-modal-custom-name-row');
        const customInput = document.getElementById('growth-modal-custom-name');
        if (!nameSelect || !customRow || !customInput) return;

        if (nameSelect.value === 'other') {
            customRow.classList.remove('hidden');
            customInput.focus();
        } else {
            customRow.classList.add('hidden');
            customInput.value = '';
        }
    });

    // Generic modal buttons
    document.getElementById('generic-modal-cancel')?.addEventListener('click', () => {
        closeModal('generic-row-modal');
        _genericModalConfig = null;
    });
    document.getElementById('generic-modal-save')?.addEventListener('click', () => saveGenericRow());

    // Dropzone visual
    initDropzone('irr-modal-dropzone', 'irr-modal-file', 'irr-modal-file-name');
    initDropzone('fert-modal-dropzone', 'fert-modal-file', 'fert-modal-file-name');

    document.getElementById('irr-modal-start-date')?.addEventListener('change', () => {
        syncModalDateRange('irr-modal-start-date', 'irr-modal-end-date');
    });
    document.getElementById('fert-modal-start-date')?.addEventListener('change', () => {
        syncModalDateRange('fert-modal-start-date', 'fert-modal-end-date');
    });
}

// =========================================
// Modal Helpers
// =========================================
function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

// =========================================
// Generic Add-Row Modal
// =========================================
let _genericModalConfig = null;

function openGenericRowModal(config) {
    _genericModalConfig = config;
    const title = document.getElementById('generic-modal-title');
    const body = document.getElementById('generic-modal-body');
    if (!title || !body) return;

    title.textContent = config.title;
    body.innerHTML = '';

    const visibleFields = config.fields.filter(f => !(config.skipFields && config.skipFields.includes(f)));

    // Group fields in pairs for 2-column layout
    for (let i = 0; i < visibleFields.length; i += 2) {
        const field1 = visibleFields[i];
        const field2 = visibleFields[i + 1];

        if (field2) {
            const grid = document.createElement('div');
            grid.className = 'modal-form-grid';
            grid.appendChild(_createGenericField(field1, config));
            grid.appendChild(_createGenericField(field2, config));
            body.appendChild(grid);
        } else {
            const wrapper = _createGenericField(field1, config);
            wrapper.className = 'modal-form-row-single';
            body.appendChild(wrapper);
        }
    }

    if (visibleFields.includes('startDate') && visibleFields.includes('endDate')) {
        syncModalDateRange('generic-modal-startDate', 'generic-modal-endDate');
        const startInput = document.getElementById('generic-modal-startDate');
        startInput?.addEventListener('change', () => syncModalDateRange('generic-modal-startDate', 'generic-modal-endDate'));
    }

    wireGenericModalConditionalLogic();

    openModal('generic-row-modal');
    setTimeout(() => {
        const firstInput = body.querySelector('input, select');
        if (firstInput) firstInput.focus();
    }, 100);
}

function updateModalActionOtherVisibility() {
    const actionSelect = document.getElementById('generic-modal-action');
    const otherInput = document.getElementById('generic-modal-actionOther');
    if (!actionSelect || !otherInput) return;
    const otherRow = otherInput.closest('.modal-form-row');
    const shouldShow = actionSelect.value === 'אחר';
    if (otherRow) otherRow.style.display = shouldShow ? '' : 'none';
    if (!shouldShow) otherInput.value = '';
}

function updateModalInoculationMethodVisibility() {
    const typeSelect = document.getElementById('generic-modal-inoculationType');
    const methodSelect = document.getElementById('generic-modal-inoculationMethod');
    if (!typeSelect || !methodSelect) return;
    const methodRow = methodSelect.closest('.modal-form-row');
    const shouldShow = typeSelect.value === 'מלאכותי';
    if (methodRow) methodRow.style.display = shouldShow ? '' : 'none';
    if (!shouldShow) methodSelect.value = '';
}

function wireGenericModalConditionalLogic() {
    const actionSelect = document.getElementById('generic-modal-action');
    if (actionSelect) {
        actionSelect.addEventListener('change', updateModalActionOtherVisibility);
        updateModalActionOtherVisibility();
    }

    const inoculationTypeSelect = document.getElementById('generic-modal-inoculationType');
    if (inoculationTypeSelect) {
        inoculationTypeSelect.addEventListener('change', updateModalInoculationMethodVisibility);
        updateModalInoculationMethodVisibility();
    }
}

function _createGenericField(field, config) {
    const row = document.createElement('div');
    row.className = 'modal-form-row';

    const label = document.createElement('label');
    label.textContent = (config.labels[field] || field) + ':';
    row.appendChild(label);

    const fieldOpts = config.fieldOptions && config.fieldOptions[field];
    if (fieldOpts && Array.isArray(fieldOpts)) {
        const select = document.createElement('select');
        select.className = 'modal-input-sm modal-select';
        select.id = `generic-modal-${field}`;

        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = `בחירת ${config.labels[field] || field}`;
        select.appendChild(emptyOpt);

        fieldOpts.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            select.appendChild(option);
        });
        row.appendChild(select);
    } else {
        const input = document.createElement('input');
        if (field === 'date' || field.endsWith('Date')) {
            input.type = 'date';
        } else if (['hours','workers','dosage','quantity','fruitFloor','damageValue','totalWater','totalFert','amount'].includes(field)) {
            input.type = 'number';
            input.step = 'any';
        } else {
            input.type = 'text';
        }
        input.className = 'modal-input-sm';
        input.id = `generic-modal-${field}`;
        const fieldDatalist = config.dynamicDatalists && config.dynamicDatalists[field];
        if (fieldDatalist && input.type === 'text') {
            input.setAttribute('list', fieldDatalist);
        }
        input.placeholder = config.labels[field] || '';
        row.appendChild(input);
    }

    return row;
}

function saveGenericRow() {
    if (!_genericModalConfig) return;
    const data = {};
    const visibleFields = _genericModalConfig.fields.filter(f => !(_genericModalConfig.skipFields && _genericModalConfig.skipFields.includes(f)));

    visibleFields.forEach(field => {
        const el = document.getElementById(`generic-modal-${field}`);
        if (el) data[field] = el.value;
    });

    if (data.startDate && data.endDate && data.endDate < data.startDate) {
        showToast('תאריך הסיום חייב להיות מאוחר או שווה לתאריך ההתחלה', 'error');
        return;
    }

    if (data.inoculationType === 'מלאכותי' && !hasValue(data.inoculationMethod)) {
        showToast('יש לבחור שיטת אילוח כאשר סוג האילוח הוא מלאכותי', 'error');
        return;
    }

    _genericModalConfig.onSave(data);
    closeModal('generic-row-modal');
    _genericModalConfig = null;
}

function initDropzone(dropzoneId, fileInputId, labelId) {
    const dropzone = document.getElementById(dropzoneId);
    const fileInput = document.getElementById(fileInputId);
    const label = document.getElementById(labelId);
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', (e) => {
        // Don't trigger again if the click came from the file input itself
        if (e.target === fileInput) return;
        fileInput.click();
    });
    // Prevent the file input's native click from bubbling to the dropzone
    fileInput.addEventListener('click', (e) => e.stopPropagation());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            if (label) label.textContent = e.dataTransfer.files[0].name;
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length && label) {
            label.textContent = fileInput.files[0].name;
        }
    });
}

function syncModalDateRange(startId, endId) {
    const startInput = document.getElementById(startId);
    const endInput = document.getElementById(endId);
    if (!startInput || !endInput) return;

    const startValue = startInput.value;
    if (startValue) {
        endInput.min = startValue;
        if (endInput.value && endInput.value < startValue) {
            endInput.value = startValue;
        }
    } else {
        endInput.removeAttribute('min');
    }
}

// =========================================
// Irrigation Modal
// =========================================
function openIrrigationModal() {
    document.getElementById('irr-modal-filename').value = '';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('irr-modal-start-date').value = today;
    document.getElementById('irr-modal-end-date').value = today;
    document.getElementById('irr-modal-total').value = '';
    document.getElementById('irr-modal-file').value = '';
    document.getElementById('irr-modal-file-name').textContent = 'גרירת קובץ לכאן או לחיצה לבחירה';
    document.getElementById('irr-modal-progress')?.classList.add('hidden');
    syncModalDateRange('irr-modal-start-date', 'irr-modal-end-date');
    openModal('irrigation-file-modal');
}

async function saveIrrigationFile() {
    const fileName = document.getElementById('irr-modal-filename').value.trim();
    const startDate = document.getElementById('irr-modal-start-date').value;
    const endDate = document.getElementById('irr-modal-end-date').value;
    const totalWater = document.getElementById('irr-modal-total').value.trim();
    const fileInput = document.getElementById('irr-modal-file');
    const file = fileInput?.files[0];

    if (!fileName) {
        showToast('יש להזין שם קובץ', 'error');
        return;
    }

    if (!startDate || !endDate) {
        showToast('יש לבחור תאריך התחלה ותאריך סיום', 'error');
        return;
    }

    if (endDate < startDate) {
        showToast('תאריך הסיום חייב להיות מאוחר או שווה לתאריך ההתחלה', 'error');
        return;
    }

    let fileUrl = '';
    let filePath = '';
    const today = new Date().toISOString().split('T')[0];

    if (file) {
        try {
            const result = await uploadProgressFile(file, 'irrigation', 'irr-modal-progress', 'irr-modal-progress-fill', 'irr-modal-progress-text');
            fileUrl = result.url;
            filePath = result.path;
        } catch (err) {
            showToast('שגיאה בהעלאת הקובץ: ' + err.message, 'error');
            return;
        }
    }

    const tbody = document.getElementById('irrigation-tbody');
    addProgressRow(tbody, IRRIGATION_FIELDS, IRRIGATION_LABELS, {
        fileName: fileName,
        uploadDate: today,
        startDate,
        endDate,
        totalWater: totalWater,
        fileUrl: fileUrl || '',
        filePath: filePath || ''
    });

    closeModal('irrigation-file-modal');
    showToast('קובץ השקיה נוסף בהצלחה', 'success');
}

// =========================================
// Fertilization Modal
// =========================================
function openFertilizationModal() {
    document.getElementById('fert-modal-filename').value = '';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('fert-modal-start-date').value = today;
    document.getElementById('fert-modal-end-date').value = today;
    document.getElementById('fert-modal-type').value = '';
    document.getElementById('fert-modal-company').value = '';
    document.getElementById('fert-modal-total').value = '';
    document.getElementById('fert-modal-file').value = '';
    document.getElementById('fert-modal-file-name').textContent = 'גרירת קובץ לכאן או לחיצה לבחירה';
    document.getElementById('fert-modal-progress')?.classList.add('hidden');
    syncModalDateRange('fert-modal-start-date', 'fert-modal-end-date');
    openModal('fertilization-file-modal');
}

async function saveFertilizationFile() {
    const fileName = document.getElementById('fert-modal-filename').value.trim();
    const startDate = document.getElementById('fert-modal-start-date').value;
    const endDate = document.getElementById('fert-modal-end-date').value;
    const fertType = document.getElementById('fert-modal-type').value.trim();
    const company = document.getElementById('fert-modal-company').value.trim();
    const totalFert = document.getElementById('fert-modal-total').value.trim();
    const fileInput = document.getElementById('fert-modal-file');
    const file = fileInput?.files[0];

    if (!fileName) {
        showToast('יש להזין שם קובץ', 'error');
        return;
    }

    if (!startDate || !endDate) {
        showToast('יש לבחור תאריך התחלה ותאריך סיום', 'error');
        return;
    }

    if (endDate < startDate) {
        showToast('תאריך הסיום חייב להיות מאוחר או שווה לתאריך ההתחלה', 'error');
        return;
    }

    let fileUrl = '';
    let filePath = '';
    const today = new Date().toISOString().split('T')[0];

    if (file) {
        try {
            const result = await uploadProgressFile(file, 'fertilization', 'fert-modal-progress', 'fert-modal-progress-fill', 'fert-modal-progress-text');
            fileUrl = result.url;
            filePath = result.path;
        } catch (err) {
            showToast('שגיאה בהעלאת הקובץ: ' + err.message, 'error');
            return;
        }
    }

    const tbody = document.getElementById('fertilization-tbody');
    registerDynamicOption('fertilizerType', fertType);
    registerDynamicOption('fertilizerCompany', company);

    addProgressRow(tbody, FERTILIZATION_FIELDS, FERTILIZATION_LABELS, {
        fileName: fileName,
        uploadDate: today,
        startDate,
        endDate,
        fertType: fertType,
        company: company,
        totalFert: totalFert,
        fileUrl: fileUrl || '',
        filePath: filePath || ''
    }, {
        dynamicDatalists: FERTILIZATION_DYNAMIC_DATALISTS
    });

    closeModal('fertilization-file-modal');
    showToast('קובץ דישון נוסף בהצלחה', 'success');
}

// =========================================
// Growth Modal
// =========================================
function openGrowthModal() {
    document.getElementById('growth-modal-name').value = '';
    const customNameInput = document.getElementById('growth-modal-custom-name');
    if (customNameInput) customNameInput.value = '';
    document.getElementById('growth-modal-date').value = '';
    document.getElementById('growth-modal-value').value = '';
    document.getElementById('growth-modal-custom-name-row')?.classList.add('hidden');
    openModal('growth-data-modal');
}

function saveGrowthData() {
    let name = document.getElementById('growth-modal-name').value;
    const customNameInput = document.getElementById('growth-modal-custom-name');
    const measureDate = document.getElementById('growth-modal-date').value;
    const value = document.getElementById('growth-modal-value').value.trim();

    if (name === 'other') {
        const customName = customNameInput?.value.trim() || '';
        if (!customName) {
            showToast('יש להזין שם נתון', 'error');
            return;
        }
        name = customName;
    }

    if (!name) {
        showToast('יש לבחור נתון', 'error');
        return;
    }

    const tbody = document.getElementById('growth-tbody');
    addProgressRow(tbody, GROWTH_FIELDS, GROWTH_LABELS, {
        name: name,
        value: value,
        measureDate: measureDate
    }, { readonlyFields: ['name'] });

    closeModal('growth-data-modal');
    showToast('נתון צימוח נוסף בהצלחה', 'success');
}

// =========================================
// Upload File to Firebase Storage (shared)
// =========================================
async function uploadProgressFile(file, folder, progressId, fillId, textId) {
    // בדיקת גודל קובץ – מקסימום 10MB (בהתאם ל-Storage Rules)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        throw new Error('גודל הקובץ חורג מהמגבלה (10MB מקסימום)');
    }
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `users/${experimentOwnerUid}/experiments/${currentExperimentId}/${folder}/${timestamp}_${safeName}`;
        const storageRef = ref(storage, path);
        const uploadTask = uploadBytesResumable(storageRef, file);

        const progressEl = document.getElementById(progressId);
        const fillEl = document.getElementById(fillId);
        const textEl = document.getElementById(textId);
        if (progressEl) progressEl.classList.remove('hidden');

        uploadTask.on('state_changed',
            (snapshot) => {
                const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                if (fillEl) fillEl.style.width = pct + '%';
                if (textEl) textEl.textContent = Math.round(pct) + '%';
            },
            (error) => {
                if (progressEl) progressEl.classList.add('hidden');
                reject(error);
            },
            async () => {
                try {
                    const url = await getDownloadURL(uploadTask.snapshot.ref);
                    if (progressEl) progressEl.classList.add('hidden');
                    resolve({ url, path });
                } catch (err) { reject(err); }
            }
        );
    });
}


