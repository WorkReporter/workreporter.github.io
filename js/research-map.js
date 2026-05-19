import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { showToast } from "./toast.js";

const ACTIVE_CONTEXT_KEY = "research-map-active-experiment-context";
const RESEARCH_MAP_HINT_DISMISSED_KEY = "research-map-hint-dismissed";
const MAX_MAP_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MAP_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];

let currentUser = null;
let currentContext = null;
let currentExperimentData = null;
let currentMapData = null;
let canEditMap = false;
let uploadInProgress = false;
let skipToggleClickAfterDrag = false;
let currentImageZoom = 1;

const IMAGE_ZOOM_MIN = 0.6;
const IMAGE_ZOOM_MAX = 3;
const IMAGE_ZOOM_STEP = 0.2;

let widgetElements = null;

document.addEventListener("DOMContentLoaded", () => {
    const pageContext = document.body?.getAttribute("data-page-context") || "";
    if (pageContext === "dashboard") return;

    mountWidget();
    initUiListeners();
    initDrag();

    onAuthStateChanged(auth, async (user) => {
        currentUser = user || null;
        if (!currentUser) {
            hideWidget();
            return;
        }

        showWidget();
        await refreshWidgetState();
    });
});

async function refreshWidgetState() {
    currentContext = resolveExperimentContext();

    if (!currentContext?.experimentId || !currentContext?.ownerUid) {
        renderNoContextState();
        return;
    }

    try {
        const experimentRef = doc(db, "users", currentContext.ownerUid, "experiments", currentContext.experimentId);
        const experimentSnap = await getDoc(experimentRef);

        if (!experimentSnap.exists()) {
            renderNoAccessState("לא נמצאו נתוני ניסוי להצגת המפה.");
            return;
        }

        currentExperimentData = experimentSnap.data() || {};
        currentMapData = currentExperimentData.researchMap || null;
        canEditMap = checkCanEditMap(currentExperimentData);

        if (currentMapData?.downloadURL) {
            renderMapState();
        } else {
            renderEmptyState();
        }
    } catch (error) {
        console.error("Failed to load research map state", error);
        renderNoAccessState("שגיאה בטעינת מפת המחקר.");
    }
}

function resolveExperimentContext() {
    const params = new URLSearchParams(window.location.search);
    const experimentId = params.get("id") || "";
    const ownerFromUrl = params.get("owner") || "";

    if (experimentId) {
        const context = {
            experimentId,
            ownerUid: ownerFromUrl || currentUser?.uid || ""
        };

        if (context.ownerUid) {
            persistContext(context);
            return context;
        }
    }

    const saved = readPersistedContext();
    if (!saved?.experimentId || !saved?.ownerUid) return null;
    return saved;
}

function persistContext(context) {
    try {
        localStorage.setItem(ACTIVE_CONTEXT_KEY, JSON.stringify(context));
    } catch (error) {
        console.warn("Could not persist research map context", error);
    }
}

function readPersistedContext() {
    try {
        const raw = localStorage.getItem(ACTIVE_CONTEXT_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function checkCanEditMap(experimentData = {}) {
    if (!currentUser || !currentContext?.ownerUid) return false;
    if (currentUser.uid === currentContext.ownerUid) return true;

    const currentEmail = (currentUser.email || "").trim().toLowerCase();
    if (!currentEmail) return false;

    const partners = Array.isArray(experimentData.partners) ? experimentData.partners : [];
    return partners.some((partner) => {
        if (typeof partner === "string") {
            return partner.trim().toLowerCase() === currentEmail;
        }

        const partnerEmail = String(partner?.email || "").trim().toLowerCase();
        return partnerEmail === currentEmail;
    });
}

function mountWidget() {
    if (document.getElementById("research-map-widget")) {
        widgetElements = collectElements();
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "research-map-widget";
    wrapper.id = "research-map-widget";
    wrapper.innerHTML = `
        <div class="research-map-panel" id="research-map-panel" aria-hidden="true">
            <div class="research-map-panel-header">
                <h4 class="research-map-panel-title"><i class="fa-solid fa-map-location-dot"></i> מפת המחקר</h4>
                <button class="btn-research-map-close" id="btn-research-map-close" aria-label="סגירת מפת המחקר">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="research-map-panel-body" id="research-map-body">
                <div class="research-map-message" id="research-map-message"></div>
                <div class="research-map-preview" id="research-map-preview"></div>
                <div class="research-map-zoom-controls" id="research-map-zoom-controls">
                    <button class="research-map-zoom-btn" id="btn-research-map-zoom-out" type="button" aria-label="הקטנת תצוגה">
                        <i class="fa-solid fa-minus"></i>
                    </button>
                    <span class="research-map-zoom-level" id="research-map-zoom-level">100%</span>
                    <button class="research-map-zoom-btn" id="btn-research-map-zoom-in" type="button" aria-label="הגדלת תצוגה">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
                <div class="research-map-meta" id="research-map-meta"></div>
                <div class="research-map-actions" id="research-map-actions">
                    <label class="research-map-upload-label" id="research-map-upload-label" for="research-map-file-input">
                        <i class="fa-solid fa-upload"></i>
                        <span>העלה/י מפה</span>
                    </label>
                    <input class="research-map-upload-input" type="file" id="research-map-file-input" accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf">
                    <button class="btn-research-map" id="btn-research-map-delete" type="button">
                        <i class="fa-solid fa-trash"></i>
                        <span>מחיקה</span>
                    </button>
                    <a class="btn-research-map" id="btn-research-map-open" href="#" target="_blank" rel="noopener noreferrer">
                        <i class="fa-solid fa-up-right-from-square"></i>
                        <span>פתיחה בחלון חדש</span>
                    </a>
                </div>
                <div class="research-map-status" id="research-map-status"></div>
            </div>
        </div>

        <button class="btn-research-map-toggle" id="btn-research-map-toggle" aria-label="פתיחת מפת המחקר">
            <i class="fa-solid fa-map"></i>
            <span>מפת המחקר</span>
        </button>

        <div class="research-map-hint" id="research-map-hint" role="note" aria-live="polite">
            <button class="research-map-hint-close" id="research-map-hint-close" aria-label="סגירת הודעת עזרה">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <span class="research-map-hint-text">ניתן להזיז את מיקום המפה חופשי במסך</span>
            <i class="fa-solid fa-arrow-down-long research-map-hint-arrow" aria-hidden="true"></i>
        </div>
    `;

    document.body.appendChild(wrapper);
    widgetElements = collectElements();
}

function collectElements() {
    return {
        widget: document.getElementById("research-map-widget"),
        panel: document.getElementById("research-map-panel"),
        toggleBtn: document.getElementById("btn-research-map-toggle"),
        closeBtn: document.getElementById("btn-research-map-close"),
        message: document.getElementById("research-map-message"),
        preview: document.getElementById("research-map-preview"),
        meta: document.getElementById("research-map-meta"),
        actions: document.getElementById("research-map-actions"),
        uploadLabel: document.getElementById("research-map-upload-label"),
        fileInput: document.getElementById("research-map-file-input"),
        deleteBtn: document.getElementById("btn-research-map-delete"),
        openBtn: document.getElementById("btn-research-map-open"),
        status: document.getElementById("research-map-status"),
        hint: document.getElementById("research-map-hint"),
        hintCloseBtn: document.getElementById("research-map-hint-close"),
        zoomControls: document.getElementById("research-map-zoom-controls"),
        zoomOutBtn: document.getElementById("btn-research-map-zoom-out"),
        zoomInBtn: document.getElementById("btn-research-map-zoom-in"),
        zoomLevel: document.getElementById("research-map-zoom-level")
    };
}

function initUiListeners() {
    if (!widgetElements) return;

    widgetElements.toggleBtn?.addEventListener("click", () => {
        if (skipToggleClickAfterDrag) {
            skipToggleClickAfterDrag = false;
            return;
        }

        const panelVisible = widgetElements.panel?.classList.contains("show");
        if (panelVisible) {
            closePanel();
            return;
        }

        openPanel();
    });

    widgetElements.closeBtn?.addEventListener("click", closePanel);

    widgetElements.fileInput?.addEventListener("change", async (event) => {
        const file = event.target?.files?.[0];
        if (!file) return;

        await uploadMapFile(file);
        event.target.value = "";
    });

    widgetElements.deleteBtn?.addEventListener("click", async () => {
        await deleteCurrentMap();
    });

    widgetElements.hintCloseBtn?.addEventListener("click", () => {
        hideHint(true);
    });

    widgetElements.zoomInBtn?.addEventListener("click", () => {
        setImageZoom(currentImageZoom + IMAGE_ZOOM_STEP);
    });

    widgetElements.zoomOutBtn?.addEventListener("click", () => {
        setImageZoom(currentImageZoom - IMAGE_ZOOM_STEP);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && widgetElements.panel?.classList.contains("show")) {
            closePanel();
        }
    });

    showHintIfNeeded();
}

function openPanel() {
    widgetElements.panel?.classList.add("show");
    widgetElements.panel?.setAttribute("aria-hidden", "false");
}

function closePanel() {
    widgetElements.panel?.classList.remove("show");
    widgetElements.panel?.setAttribute("aria-hidden", "true");
}

function initDrag() {
    if (!widgetElements?.widget || !widgetElements?.toggleBtn) return;

    const dragHandles = [widgetElements.toggleBtn, widgetElements.panel?.querySelector(".research-map-panel-header")].filter(Boolean);
    if (!dragHandles.length) return;

    let isDragging = false;
    let hasMoved = false;
    let startX = 0;
    let startY = 0;
    let originalLeft = 0;
    let originalBottom = 0;
    const dragThreshold = 5;

    const beginDrag = (event) => {
        if (event.button !== undefined && event.button !== 0) return;

        const widgetRect = widgetElements.widget.getBoundingClientRect();
        originalLeft = widgetRect.left;
        originalBottom = window.innerHeight - widgetRect.bottom;
        startX = event.clientX;
        startY = event.clientY;
        hasMoved = false;
        isDragging = true;

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    };

    const onPointerMove = (event) => {
        if (!isDragging) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (!hasMoved && distance < dragThreshold) return;

        hasMoved = true;
        widgetElements.widget.classList.add("dragging");

        let nextLeft = originalLeft + dx;
        let nextBottom = originalBottom - dy;

        const rect = widgetElements.widget.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxBottom = Math.max(0, window.innerHeight - rect.height);

        nextLeft = Math.max(0, Math.min(nextLeft, maxLeft));
        nextBottom = Math.max(0, Math.min(nextBottom, maxBottom));

        widgetElements.widget.style.left = `${nextLeft}px`;
        widgetElements.widget.style.bottom = `${nextBottom}px`;
        widgetElements.widget.style.right = "auto";
    };

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;

        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);

        if (hasMoved) {
            skipToggleClickAfterDrag = true;
        }

        widgetElements.widget.classList.remove("dragging");
    };

    dragHandles.forEach((handle) => {
        handle.style.cursor = "grab";
        handle.addEventListener("pointerdown", beginDrag);
    });
}

function hideWidget() {
    widgetElements.widget?.classList.add("hidden");
}

function showWidget() {
    widgetElements.widget?.classList.remove("hidden");
}

function showHintIfNeeded() {
    if (!widgetElements?.hint) return;
    const dismissed = localStorage.getItem(RESEARCH_MAP_HINT_DISMISSED_KEY) === "1";
    if (dismissed) {
        hideHint(false);
        return;
    }

    widgetElements.hint.classList.remove("hidden");
}

function hideHint(shouldPersist) {
    if (!widgetElements?.hint) return;
    widgetElements.hint.classList.add("hidden");

    if (shouldPersist) {
        try {
            localStorage.setItem(RESEARCH_MAP_HINT_DISMISSED_KEY, "1");
        } catch {
            // no-op
        }
    }
}

function renderNoContextState() {
    setMessage("כדי לצפות במפת המחקר יש לבחור ניסוי תחילה.");
    setPreviewHtml(`<div class="research-map-message">לא נמצא ניסוי פעיל. ניתן לפתוח ניסוי מהדשבורד, ואז המפה תהיה זמינה בכל העמודים.</div>`);
    widgetElements.meta.innerHTML = "";
    setStatus("");
    setActionsState({ canUpload: false, canDelete: false, canOpen: false });
    setZoomControlsEnabled(false);
}

function renderNoAccessState(message) {
    setMessage(message || "אין הרשאה לצפייה במפה זו.");
    setPreviewHtml(`<div class="research-map-message">${escapeHtml(message || "אין הרשאה לצפייה במפה זו.")}</div>`);
    widgetElements.meta.innerHTML = "";
    setStatus("", "error");
    setActionsState({ canUpload: false, canDelete: false, canOpen: false });
    setZoomControlsEnabled(false);
}

function renderEmptyState() {
    setMessage("עדיין לא הועלתה מפת מחקר לניסוי זה.");
    setPreviewHtml(`<div class="research-map-message">ניתן להעלות קובץ תמונה או PDF של מפת המחקר.</div>`);
    widgetElements.meta.innerHTML = "";
    setStatus("");
    setActionsState({ canUpload: canEditMap, canDelete: false, canOpen: false });
    setZoomControlsEnabled(false);
}

function renderMapState() {
    setMessage("מפת המחקר של הניסוי מוצגת כאן.");
    renderPreview(currentMapData);

    const fileName = escapeHtml(currentMapData?.fileName || "ללא שם קובץ");
    const fileType = escapeHtml(currentMapData?.fileType || "לא ידוע");

    widgetElements.meta.innerHTML = `
        <div><strong>קובץ:</strong> ${fileName}</div>
        <div><strong>סוג:</strong> ${fileType}</div>
    `;

    widgetElements.openBtn.href = currentMapData?.downloadURL || "#";
    setStatus("");
    setActionsState({ canUpload: canEditMap, canDelete: canEditMap, canOpen: true });
}

function renderPreview(mapData = {}) {
    const url = mapData?.downloadURL || "";
    const type = String(mapData?.fileType || "").toLowerCase();
    const fileName = String(mapData?.fileName || "").toLowerCase();

    if (!url) {
        setPreviewHtml(`<div class="research-map-message">לא נמצאה תצוגה למפה.</div>`);
        return;
    }

    if (type.startsWith("image/")) {
        setPreviewHtml(`<img id="research-map-preview-image" src="${escapeAttr(url)}" alt="מפת המחקר">`);
        currentImageZoom = 1;
        setZoomControlsEnabled(true);
        applyImageZoom();
        return;
    }

    if (type === "application/pdf" || fileName.endsWith(".pdf")) {
        setPreviewHtml(`<iframe src="${escapeAttr(url)}" title="תצוגת PDF של מפת המחקר"></iframe>`);
        setZoomControlsEnabled(false);
        return;
    }

    setPreviewHtml(`<div class="research-map-message">לא ניתן להציג תצוגה מקדימה. אפשר לפתוח את הקובץ בחלון חדש.</div>`);
    setZoomControlsEnabled(false);
}

function setZoomControlsEnabled(enabled) {
    if (!widgetElements?.zoomControls) return;

    widgetElements.zoomControls.style.display = enabled ? "inline-flex" : "none";
    if (!enabled) {
        currentImageZoom = 1;
        updateZoomUi();
        return;
    }

    updateZoomUi();
}

function setImageZoom(nextZoom) {
    const imageEl = document.getElementById("research-map-preview-image");
    if (!imageEl) return;

    const clamped = Math.max(IMAGE_ZOOM_MIN, Math.min(IMAGE_ZOOM_MAX, nextZoom));
    currentImageZoom = clamped;
    applyImageZoom();
}

function applyImageZoom() {
    const imageEl = document.getElementById("research-map-preview-image");
    if (!imageEl) {
        updateZoomUi();
        return;
    }

    imageEl.style.transform = `scale(${currentImageZoom})`;
    updateZoomUi();
}

function updateZoomUi() {
    if (!widgetElements?.zoomLevel) return;

    const percent = Math.round(currentImageZoom * 100);
    widgetElements.zoomLevel.textContent = `${percent}%`;

    if (widgetElements.zoomOutBtn) {
        widgetElements.zoomOutBtn.disabled = currentImageZoom <= IMAGE_ZOOM_MIN + 0.001;
    }

    if (widgetElements.zoomInBtn) {
        widgetElements.zoomInBtn.disabled = currentImageZoom >= IMAGE_ZOOM_MAX - 0.001;
    }
}

function setActionsState({ canUpload, canDelete, canOpen }) {
    toggleDisabled(widgetElements.uploadLabel, !canUpload, true);
    toggleDisabled(widgetElements.fileInput, !canUpload, false);
    toggleDisabled(widgetElements.deleteBtn, !canDelete, false);
    toggleDisabled(widgetElements.openBtn, !canOpen, false);
}

function toggleDisabled(element, disabled, addClassOnly) {
    if (!element) return;

    if (disabled) {
        element.classList.add("disabled");
    } else {
        element.classList.remove("disabled");
    }

    if (!addClassOnly) {
        element.disabled = !!disabled;
    }
}

async function uploadMapFile(file) {
    if (uploadInProgress) return;

    if (!canEditMap) {
        showToast("אין הרשאה להעלאת מפה", "error");
        return;
    }

    if (!file || !currentContext?.experimentId || !currentContext?.ownerUid) {
        showToast("לא נמצא ניסוי פעיל להעלאה", "error");
        return;
    }

    if (file.size > MAX_MAP_FILE_SIZE) {
        showToast("הקובץ גדול מדי. גודל מקסימלי: 10MB", "error");
        return;
    }

    const normalizedType = (file.type || "").toLowerCase();
    const accepted = ALLOWED_MAP_TYPES.includes(normalizedType) || (normalizedType.startsWith("image/") && !normalizedType.includes("svg"));
    if (!accepted) {
        showToast("ניתן להעלות רק תמונות או PDF", "error");
        return;
    }

    uploadInProgress = true;
    setStatus("מעלה קובץ... 0%", "");
    setActionsState({ canUpload: false, canDelete: false, canOpen: false });

    const previousPath = currentMapData?.filePath || "";

    try {
        const safeFileName = file.name.replace(/\s+/g, "_");
        const storagePath = `users/${currentContext.ownerUid}/experiments/${currentContext.experimentId}/research-map/${Date.now()}_${safeFileName}`;
        const storageRef = ref(storage, storagePath);

        const uploadTask = uploadBytesResumable(storageRef, file, { contentType: file.type || undefined });

        const taskSnapshot = await new Promise((resolve, reject) => {
            uploadTask.on("state_changed", (snapshot) => {
                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                setStatus(`מעלה קובץ... ${progress}%`);
            }, reject, () => resolve(uploadTask.snapshot));
        });

        const downloadURL = await getDownloadURL(taskSnapshot.ref);

        const newMapData = {
            filePath: storagePath,
            fileName: file.name,
            fileType: file.type || "application/octet-stream",
            downloadURL,
            uploadedBy: currentUser.uid,
            uploadedAt: serverTimestamp()
        };

        const experimentRef = doc(db, "users", currentContext.ownerUid, "experiments", currentContext.experimentId);
        await updateDoc(experimentRef, {
            researchMap: newMapData,
            updatedAt: serverTimestamp()
        });

        currentMapData = {
            ...newMapData,
            uploadedAt: new Date().toISOString()
        };
        renderMapState();

        if (previousPath && previousPath !== storagePath) {
            deleteObject(ref(storage, previousPath)).catch(() => {});
        }

        setStatus("הקובץ הועלה בהצלחה", "success");
        showToast("מפת המחקר נשמרה בהצלחה", "success");
    } catch (error) {
        console.error("Upload research map failed", error);
        setStatus("שגיאה בהעלאת הקובץ", "error");
        showToast("שגיאה בהעלאת מפת המחקר", "error");

        if (currentMapData?.downloadURL) {
            renderMapState();
        } else {
            renderEmptyState();
        }
    } finally {
        uploadInProgress = false;
    }
}

async function deleteCurrentMap() {
    if (uploadInProgress || !currentMapData?.filePath) return;

    if (!canEditMap) {
        showToast("אין הרשאה למחיקת המפה", "error");
        return;
    }

    const shouldDelete = window.confirm("האם למחוק את מפת המחקר? ניתן יהיה להעלות מפה חדשה בכל רגע.");
    if (!shouldDelete) return;

    try {
        const experimentRef = doc(db, "users", currentContext.ownerUid, "experiments", currentContext.experimentId);
        const filePathToDelete = currentMapData.filePath;

        await updateDoc(experimentRef, {
            researchMap: null,
            updatedAt: serverTimestamp()
        });

        await deleteObject(ref(storage, filePathToDelete)).catch(() => {});

        currentMapData = null;
        renderEmptyState();
        setStatus("המפה נמחקה", "success");
        showToast("מפת המחקר נמחקה", "success");
    } catch (error) {
        console.error("Delete research map failed", error);
        setStatus("שגיאה במחיקת המפה", "error");
        showToast("שגיאה במחיקת המפה", "error");
    }
}

function setMessage(text) {
    if (!widgetElements.message) return;
    widgetElements.message.textContent = text || "";
}

function setPreviewHtml(html) {
    if (!widgetElements.preview) return;
    widgetElements.preview.innerHTML = html || "";
}

function setStatus(text, tone = "") {
    if (!widgetElements.status) return;
    widgetElements.status.className = "research-map-status";
    if (tone) {
        widgetElements.status.classList.add(tone);
    }
    widgetElements.status.textContent = text || "";
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}
