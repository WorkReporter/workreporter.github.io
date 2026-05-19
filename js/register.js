import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from "./toast.js";

// פונקציה לתרגום שגיאות Firebase לעברית
function getHebrewErrorMessage(errorCode) {
    const errorMessages = {
        'auth/email-already-in-use': 'כתובת האימייל כבר רשומה במערכת',
        'auth/invalid-email': 'כתובת האימייל אינה תקינה',
        'auth/operation-not-allowed': 'פעולה זו אינה מותרת',
        'auth/weak-password': 'הסיסמה חלשה מדי. נדרשות לפחות 6 תווים',
        'auth/network-request-failed': 'בעיית תקשורת. יש לבדוק את חיבור האינטרנט'
    };
    return errorMessages[errorCode] || 'שגיאה בהרשמה. יש לנסות שוב';
}

// Helper: Toggle button loading state
function setButtonLoading(btn, isLoading) {
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="btn-spinner"></span><span class="btn-text">נרשם...</span>';
    } else {
        btn.disabled = false;
        if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
    }
}

function isValidName(nameValue) {
    return /^[A-Za-z\u0590-\u05FF\s'"\-]+$/.test(nameValue);
}

document.getElementById('btn-register').addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const fname = document.getElementById('reg-fname').value.trim();
    const lname = document.getElementById('reg-lname').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const role = document.getElementById('reg-role').value;
    const registerBtn = document.getElementById('btn-register');

    if(!email || !pass || !fname || !lname || !phone || !role) {
        showToast("נא למלא שדות חובה: שם פרטי, שם משפחה, אימייל, סיסמה, טלפון ותפקיד", "warning");
        return;
    }

    if(!isValidName(fname) || !isValidName(lname)) {
        showToast("שמות פרטיים ומשפחה חייבים להכיל אותיות בעברית או באנגלית בלבד", "warning");
        return;
    }

    if(pass.length < 6) {
        showToast("הסיסמה חייבת להכיל לפחות 6 תווים", "warning");
        return;
    }

    setButtonLoading(registerBtn, true);

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        const user = userCredential.user;

        // שמירת נתונים מלאים ב-users (פרטי - רק המשתמש עצמו יכול לקרוא)
        // isApproved: false - משתמש חדש צריך אישור מנהל לפני גישה למערכת
        await setDoc(doc(db, "users", user.uid), {
            firstName: fname,
            lastName: lname,
            email: email,
            phone: phone,
            role: role,
            isApproved: false,  // ברירת מחדל: לא מאושר - דורש אישור מנהל
            createdAt: new Date()
        });

        // שמירת נתונים ציבוריים בלבד ב-publicUsers (כל מי שמחובר יכול לקרוא)
        // אוסף זה משמש לבחירת שותפים - לא חושף phone או createdAt
        await setDoc(doc(db, "publicUsers", user.uid), {
            uid: user.uid,
            firstName: fname,
            lastName: lname,
            email: email,
            role: role
        });

        showToast("ההרשמה בוצעה בהצלחה! ממתין לאישור מנהל המערכת...", "success");

        // התנתק את המשתמש - כי הוא עדיין לא מאושר
        await signOut(auth);

        setTimeout(() => {
            window.location.href = "login.html";
        }, 2000);

    } catch (error) {
        console.error("Registration error:", error.code);
        showToast(getHebrewErrorMessage(error.code), "error");
    } finally {
        setButtonLoading(registerBtn, false);
    }
});
