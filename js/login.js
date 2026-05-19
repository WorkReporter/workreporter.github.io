 
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from "./toast.js";

// בדיקה אם המשתמש כבר מחובר ומאושר - אם כן, העבר לדשבורד
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDocSnap = await getDoc(doc(db, "users", user.uid));
            if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                if (userData.isApproved === true) {
                    // משתמש מחובר ומאושר - העבר לדשבורד
                    window.location.href = "dashboard.html";
                }
                // אם לא מאושר - לא עושים כלום, המשתמש נשאר בדף ההתחברות
                // ההודעה תוצג רק כשהוא לוחץ על כפתור ההתחברות
            }
        } catch (error) {
            console.error("Error checking user approval:", error);
        }
    }
});

// פונקציה לתרגום שגיאות Firebase לעברית
function getHebrewErrorMessage(errorCode) {
    const errorMessages = {
        'auth/invalid-email': 'כתובת האימייל אינה תקינה',
        'auth/user-disabled': 'חשבון המשתמש הושבת',
        'auth/user-not-found': 'משתמש לא נמצא במערכת',
        'auth/wrong-password': 'סיסמה שגויה',
        'auth/invalid-credential': 'פרטי הכניסה שגויים',
        'auth/too-many-requests': 'יותר מדי נסיונות כניסה. יש לנסות שוב מאוחר יותר',
        'auth/network-request-failed': 'בעיית תקשורת. יש לבדוק את חיבור האינטרנט',
        'auth/invalid-login-credentials': 'אימייל או סיסמה שגויים'
    };
    return errorMessages[errorCode] || 'שגיאה בהתחברות. יש לנסות שוב';
}

// Helper: Toggle button loading state
function setButtonLoading(btn, isLoading) {
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="btn-spinner"></span><span class="btn-text">מאמת...</span>';
    } else {
        btn.disabled = false;
        if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
    }
}

document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    const loginBtn = document.getElementById('btn-login');

    if (!email || !pass) {
        showToast('נא למלא אימייל וסיסמה', 'warning');
        return;
    }

    setButtonLoading(loginBtn, true);

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, pass);
        const user = userCredential.user;

        // בדיקה אם המשתמש מאושר
        const userDocSnap = await getDoc(doc(db, "users", user.uid));
        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            if (userData.isApproved === true) {
                // המשתמש מאושר - המעבר יתבצע ע"י onAuthStateChanged
                showToast('התחברת בהצלחה!', 'success');
            } else {
                // משתמש לא מאושר - התנתק אותו
                await signOut(auth);
                showToast('  חשבונך ממתין לאישור מנהל המערכת. נא לפנות למנהל המערכת. yehudah@volcani.agri.gov.il', 'warning', 5000);
            }
        } else {
            // אין מסמך משתמש - משתמש ישן, יש ליצור לו מסמך או ליצור קשר עם מנהל
            await signOut(auth);
            showToast('יש בעיה בחשבונך. נא לפנות למנהל המערכת.', 'error');
        }
    } catch (error) {
        console.error("Login error:", error.code);
        showToast(getHebrewErrorMessage(error.code), 'error');
    } finally {
        setButtonLoading(loginBtn, false);
    }
});