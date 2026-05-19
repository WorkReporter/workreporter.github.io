// js/admin-experiments.js
import { auth, db } from "./firebase-config.js";
import { formatDateIL } from "./date-utils.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collectionGroup,
    query,
    getDocs,
    doc,
    getDoc,
    collection
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from "./toast.js";

let currentUser = null;
let allExperiments = [];
let filteredExperiments = [];

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
});

// Initialize event listeners
function initEventListeners() {
    // Hamburger menu (Mobile)
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (hamburgerBtn && sidebar) {
        hamburgerBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
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

    // Search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterExperiments(e.target.value);
        });
    }

    // Logout button
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

// Auth state listener
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    await loadUserInfo();

    // מנסים לטעון ניסויים - אם אין הרשאות, loadAllExperiments תטפל בזה
    await loadAllExperiments();
});


// טעינת פרטי המשתמש המחובר
async function loadUserInfo() {
    const userDisplayName = document.getElementById('user-display-name');
    try {
        const docSnap = await getDoc(doc(db, "users", currentUser.uid));
        if (docSnap.exists()) {
            const userData = docSnap.data();
            const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim();
            if (userDisplayName) {
                userDisplayName.textContent = fullName || currentUser.email || 'מנהל';
            }
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
    }
}

// טעינת כל הניסויים באמצעות collectionGroup
async function loadAllExperiments() {
    const loadingContainer = document.getElementById('loading-container');
    const tableContainer = document.getElementById('experiments-table-container');

    if (loadingContainer) loadingContainer.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';

    try {
        // שימוש ב-collectionGroup לשליפת כל הניסויים מכל המשתמשים
        // זה עובד רק אם הגדרת את ה-Firestore Rules כמו שהראית
        const experimentsQuery = query(collectionGroup(db, 'experiments'));
        const querySnapshot = await getDocs(experimentsQuery);

        allExperiments = [];

        // לכל ניסוי - קבל גם את פרטי הבעלים
        for (const docSnap of querySnapshot.docs) {
            const experimentData = docSnap.data();

            // חילוץ ה-ownerUid מה-path (users/{ownerUid}/experiments/{experimentId})
            const pathParts = docSnap.ref.path.split('/');
            const ownerUid = pathParts[1]; // users/{ownerUid}/experiments/{experimentId}

            allExperiments.push({
                id: docSnap.id,
                ownerUid: ownerUid,
                ...experimentData
            });
        }

        console.log(`נמצאו ${allExperiments.length} ניסויים במערכת`);

        // עדכון סטטיסטיקות
        updateStatistics();

        // הצגת הניסויים
        filteredExperiments = [...allExperiments];
        displayExperiments();

    } catch (error) {
        // שגיאת הרשאות = אין גישה לדף זה
        console.error("Error loading experiments:", error);
        showToast('אין לך הרשאות גישה לדף זה', 'error');
        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 1500);
    } finally {
        if (loadingContainer) loadingContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.display = 'block';
    }
}

// עדכון סטטיסטיקות
function updateStatistics() {
    // סה"כ ניסויים
    const totalEl = document.getElementById('total-experiments');
    if (totalEl) totalEl.textContent = allExperiments.length;


    // מספר חוקרים ייחודיים
    const uniqueOwners = new Set(allExperiments.map(exp => exp.ownerUid));
    const researchersEl = document.getElementById('total-researchers');
    if (researchersEl) researchersEl.textContent = uniqueOwners.size;
}

// סינון ניסויים לפי חיפוש
function filterExperiments(searchTerm) {
    const term = searchTerm.toLowerCase().trim();

    if (!term) {
        filteredExperiments = [...allExperiments];
    } else {
        filteredExperiments = allExperiments.filter(exp => {
            const name = (exp.experimentName || '').toLowerCase();
            const researcher = (exp.leadResearcher || '').toLowerCase();
            const site = (exp.experimentSite || '').toLowerCase();

            return name.includes(term) || researcher.includes(term) || site.includes(term);
        });
    }

    displayExperiments();
}

// הצגת ניסויים בטבלה
function displayExperiments() {
    const tbody = document.getElementById('experiments-table-body');
    const emptyState = document.getElementById('empty-state');
    const tableContainer = document.getElementById('experiments-table-container');

    if (!tbody) return;

    // אם אין ניסויים - הצג מסך ריק
    if (filteredExperiments.length === 0) {
        if (tableContainer) tableContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (tableContainer) tableContainer.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = '';

    // מיון לפי תאריך יצירה (החדשים ראשון)
    const sortedExperiments = [...filteredExperiments].sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return dateB - dateA;
    });

    sortedExperiments.forEach(experiment => {
        const row = document.createElement('tr');

        const name = experiment.experimentName || 'ניסוי ללא שם';
        const researcher = experiment.leadResearcher || 'לא צוין';
        const site = experiment.experimentSite || 'לא צוין';
        const year = experiment.experimentYear || '-';
        const createdDate = formatDateIL(experiment.createdAt, 'לא ידוע');

        row.innerHTML = `
            <td data-label="שם הניסוי"><strong>${name}</strong></td>
            <td data-label="חוקר מוביל">${researcher}</td>
            <td data-label="אתר">${site}</td>
            <td data-label="שנה">${year}</td>
            <td data-label="תאריך יצירה">${createdDate}</td>
            <td data-label="פעולות">
                <button class="view-btn" data-experiment-id="${experiment.id}" data-owner-uid="${experiment.ownerUid}">
                    <i class="fas fa-eye"></i> צפייה
                </button>
            </td>
        `;

        // Click on row to view
        row.addEventListener('click', (e) => {
            if (e.target.closest('.view-btn')) return; // אם לחצו על הכפתור - אל תטפל בשורה
            viewExperiment(experiment.id, experiment.ownerUid);
        });

        tbody.appendChild(row);
    });

    // הוספת Event Listeners לכפתורי צפייה
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const experimentId = btn.dataset.experimentId;
            const ownerUid = btn.dataset.ownerUid;
            viewExperiment(experimentId, ownerUid);
        });
    });
}

// צפייה בניסוי
function viewExperiment(experimentId, ownerUid) {
    // ניתוב לדף הניסוי עם פרמטר owner
    window.location.href = `experiment.html?id=${experimentId}&owner=${ownerUid}`;
}



// התנתקות
async function handleLogout() {
    try {
        await signOut(auth);
        window.location.href = "login.html";
    } catch (error) {
        console.error("Error signing out:", error);
    }
}

