// js/admin-users.js
import { auth, db } from "./firebase-config.js";
import { formatDateIL } from "./date-utils.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection,
    getDocs,
    doc,
    getDoc,
    updateDoc,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from "./toast.js";

let currentUser = null;
let allUsers = [];
let currentFilter = 'all';

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

    // Filter buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            displayUsers();
        });
    });

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

    // מנסים לטעון משתמשים - אם אין הרשאות, loadAllUsers תזרוק שגיאה
    // ואז נחזיר לדשבורד
    await loadAllUsers();
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

// טעינת כל המשתמשים
// אם אין הרשאות - Firestore יזרוק שגיאה ונחזיר לדשבורד
async function loadAllUsers() {
    const loadingContainer = document.getElementById('loading-container');
    const tableContainer = document.getElementById('users-table-container');

    if (loadingContainer) loadingContainer.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';

    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);

        allUsers = [];
        querySnapshot.forEach((doc) => {
            allUsers.push({
                id: doc.id,
                ...doc.data()
            });
        });

        displayUsers();

    } catch (error) {
        // שגיאת הרשאות = אין גישה לדף זה
        console.error("Error loading users:", error);
        showToast('אין לך הרשאות גישה לדף זה', 'error');
        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 1500);
    } finally {
        if (loadingContainer) loadingContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.display = 'block';
    }
}

// הצגת משתמשים בטבלה לפי הסינון
function displayUsers() {
    const tbody = document.getElementById('users-table-body');
    const emptyState = document.getElementById('empty-state');
    const tableContainer = document.getElementById('users-table-container');

    if (!tbody) return;

    // סינון משתמשים
    let filteredUsers = allUsers;

    if (currentFilter === 'pending') {
        filteredUsers = allUsers.filter(u => u.isApproved === false);
    } else if (currentFilter === 'approved') {
        filteredUsers = allUsers.filter(u => u.isApproved === true && u.role !== 'admin');
    } else if (currentFilter === 'admin') {
        filteredUsers = allUsers.filter(u => u.role === 'admin');
    }

    // אם אין משתמשים - הצג מסך ריק
    if (filteredUsers.length === 0) {
        if (tableContainer) tableContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (tableContainer) tableContainer.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = '';

    filteredUsers.forEach(user => {
        const row = document.createElement('tr');

        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'לא צוין';
        const email = user.email || 'לא צוין';
        const role = getRoleText(user.role);
        const statusBadge = getStatusBadge(user);
        const createdDate = formatDateIL(user.createdAt, 'לא ידוע');

        row.innerHTML = `
            <td data-label="שם">${fullName}</td>
            <td data-label="אימייל">${email}</td>
            <td data-label="תפקיד">${role}</td>
            <td data-label="סטטוס">${statusBadge}</td>
            <td data-label="תאריך הרשמה">${createdDate}</td>
            <td data-label="פעולות">
                ${getActionButtons(user)}
            </td>
        `;

        tbody.appendChild(row);
    });

    // הוספת Event Listeners לכפתורי הפעולה
    attachActionButtons();
}

// קבלת טקסט תפקיד בעברית
function getRoleText(role) {
    const roles = {
        'admin': 'מנהל',
        'researcher': 'חוקר',
        'technician': 'טכנאי',
        'student': 'סטודנט',
        'other': 'אחר'
    };
    return roles[role] || role;
}

// קבלת תג סטטוס
function getStatusBadge(user) {
    if (user.role === 'admin') {
        return '<span class="status-badge admin"><i class="fas fa-user-shield"></i> מנהל</span>';
    }
    if (user.isApproved === true) {
        return '<span class="status-badge approved"><i class="fas fa-check"></i> מאושר</span>';
    }
    return '<span class="status-badge pending"><i class="fas fa-clock"></i> ממתין לאישור</span>';
}

// קבלת כפתורי פעולה
function getActionButtons(user) {
    // אם המשתמש הוא המנהל המחובר - אי אפשר לערוך את עצמו
    const isSelf = user.id === currentUser.uid;

    if (user.isApproved === false) {
        return `
            <button class="action-btn approve" data-user-id="${user.id}" ${isSelf ? 'disabled' : ''}>
                <i class="fas fa-check"></i> אשר
            </button>
            <button class="action-btn reject" data-user-id="${user.id}" ${isSelf ? 'disabled' : ''}>
                <i class="fas fa-times"></i> דחה
            </button>
        `;
    }

    return `
        <button class="action-btn view" data-user-id="${user.id}">
            <i class="fas fa-eye"></i> צפייה
        </button>
    `;
}

// חיבור Event Listeners לכפתורי הפעולה
function attachActionButtons() {
    // כפתורי אישור
    document.querySelectorAll('.action-btn.approve').forEach(btn => {
        btn.addEventListener('click', async () => {
            const userId = btn.dataset.userId;
            await approveUser(userId);
        });
    });

    // כפתורי דחייה
    document.querySelectorAll('.action-btn.reject').forEach(btn => {
        btn.addEventListener('click', async () => {
            const userId = btn.dataset.userId;
            if (confirm('האם אתה בטוח שברצונך לדחות את המשתמש?')) {
                await rejectUser(userId);
            }
        });
    });

    // כפתורי צפייה
    document.querySelectorAll('.action-btn.view').forEach(btn => {
        btn.addEventListener('click', () => {
            const userId = btn.dataset.userId;
            viewUser(userId);
        });
    });
}

// אישור משתמש
async function approveUser(userId) {
    try {
        await updateDoc(doc(db, "users", userId), {
            isApproved: true
        });

        showToast('המשתמש אושר בהצלחה!', 'success');
        await loadAllUsers(); // טען מחדש את הרשימה
    } catch (error) {
        console.error("Error approving user:", error);
        showToast('שגיאה באישור משתמש', 'error');
    }
}

// דחיית משתמש (שינוי סטטוס חזרה לא מאושר)
async function rejectUser(userId) {
    try {
        await updateDoc(doc(db, "users", userId), {
            isApproved: false
        });

        showToast('המשתמש נדחה', 'info');
        await loadAllUsers();
    } catch (error) {
        console.error("Error rejecting user:", error);
        showToast('שגיאה בדחיית משתמש', 'error');
    }
}

// צפייה בפרטי משתמש
function viewUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const details = `
שם: ${fullName}
אימייל: ${user.email}
טלפון: ${user.phone || 'לא צוין'}
תפקיד: ${getRoleText(user.role)}
סטטוס: ${user.isApproved ? 'מאושר' : 'ממתין לאישור'}
תאריך הרשמה: ${formatDateIL(user.createdAt, 'לא ידוע')}
    `.trim();

    alert(details);
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

