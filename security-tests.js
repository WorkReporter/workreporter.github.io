// בדיקות אבטחה למערכת דיווח שעות וולקני
// העתק והדבק את הקוד הזה ב-Console של הדפדפן

console.log('🔒 מתחיל בדיקות אבטחה...');

// ===== בדיקה 1: חשיפת מידע רגיש =====
console.log('\n📋 בדיקה 1: חשיפת מידע רגיש');
console.log('APP_CONFIG:', window.APP_CONFIG);
console.log('Firebase Config:', window.APP_CONFIG?.firebaseConfig);
console.log('Admin Email:', window.APP_CONFIG?.adminEmail);
console.log('Current User:', window.auth?.currentUser);

// ===== בדיקה 2: גישה למסד הנתונים =====
console.log('\n🗄️ בדיקה 2: גישה למסד הנתונים');
if (window.database) {
    // נסה לגשת לכל המשתמשים
    window.database.ref('users').once('value')
        .then(snapshot => {
            console.log('✅ גישה לכל המשתמשים:', snapshot.val());
        })
        .catch(error => {
            console.log('❌ נחסם בהצלחה:', error.message);
        });
    
    // נסה לגשת לכל הדוחות
    window.database.ref('reports').once('value')
        .then(snapshot => {
            console.log('✅ גישה לכל הדוחות:', snapshot.val());
        })
        .catch(error => {
            console.log('❌ נחסם בהצלחה:', error.message);
        });
} else {
    console.log('❌ לא נמצא מסד נתונים');
}

// ===== בדיקה 3: גישה לנתונים של משתמש אחר =====
console.log('\n👤 בדיקה 3: גישה לנתונים של משתמש אחר');
if (window.database) {
    // נסה לגשת למשתמש שלא קיים
    const fakeUserId = 'fake-user-123';
    window.database.ref(`users/${fakeUserId}`).once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                console.log('⚠️ גישה למשתמש אחר:', snapshot.val());
            } else {
                console.log('✅ משתמש לא קיים - תקין');
            }
        })
        .catch(error => {
            console.log('❌ נחסם בהצלחה:', error.message);
        });
}

// ===== בדיקה 4: בדיקת הרשאות כתיבה =====
console.log('\n✏️ בדיקה 4: בדיקת הרשאות כתיבה');
if (window.database) {
    const testData = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        createdAt: new Date().toISOString()
    };
    
    // נסה לכתוב למשתמש חדש
    window.database.ref('users/test-user-123').set(testData)
        .then(() => {
            console.log('⚠️ הצלחתי לכתוב למשתמש חדש!');
        })
        .catch(error => {
            console.log('❌ נחסם בהצלחה:', error.message);
        });
}

// ===== בדיקה 5: בדיקת Local Storage =====
console.log('\n💾 בדיקה 5: בדיקת Local Storage');
console.log('Local Storage:', localStorage);
console.log('Session Storage:', sessionStorage);

// בדוק אם יש מידע רגיש ב-Local Storage
const sensitiveKeys = ['firebase', 'auth', 'token', 'user', 'admin'];
sensitiveKeys.forEach(key => {
    Object.keys(localStorage).forEach(storageKey => {
        if (storageKey.toLowerCase().includes(key)) {
            console.log(`⚠️ מידע רגיש ב-Local Storage: ${storageKey}`, localStorage.getItem(storageKey));
        }
    });
});

// ===== בדיקה 6: בדיקת Network Requests =====
console.log('\n🌐 בדיקה 6: בדיקת Network Requests');
const networkRequests = performance.getEntriesByType('resource');
console.log('בקשות רשת:', networkRequests);

// בדוק בקשות ל-Firebase
const firebaseRequests = networkRequests.filter(req => 
    req.name.includes('firebase') || 
    req.name.includes('googleapis') ||
    req.name.includes('firebaseio.com')
);
console.log('בקשות Firebase:', firebaseRequests);

// ===== בדיקה 7: בדיקת XSS =====
console.log('\n🛡️ בדיקה 7: בדיקת XSS');
// בדוק אם יש פונקציות escape
if (typeof window.escapeHtml === 'function') {
    console.log('✅ פונקציית escape קיימת');
    const testXSS = '<script>alert("XSS")</script>';
    console.log('Test XSS:', testXSS);
    console.log('Escaped:', window.escapeHtml(testXSS));
} else {
    console.log('⚠️ לא נמצאה פונקציית escape');
}

// ===== בדיקה 8: בדיקת Authentication State =====
console.log('\n🔐 בדיקה 8: בדיקת Authentication State');
if (window.auth) {
    window.auth.onAuthStateChanged((user) => {
        if (user) {
            console.log('✅ משתמש מחובר:', user.email);
            console.log('User ID:', user.uid);
            console.log('Email Verified:', user.emailVerified);
            console.log('Is Admin:', user.email === window.APP_CONFIG?.adminEmail);
        } else {
            console.log('❌ אין משתמש מחובר');
        }
    });
}

// ===== בדיקה 9: בדיקת CSRF =====
console.log('\n🔄 בדיקה 9: בדיקת CSRF');
// נסה לבצע בקשה POST ללא אימות
fetch('/api/test', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({test: 'csrf'})
})
.then(response => {
    console.log('CSRF Test Response:', response.status);
})
.catch(error => {
    console.log('CSRF Test Error:', error.message);
});

// ===== בדיקה 10: בדיקת Security Headers =====
console.log('\n🛡️ בדיקה 10: בדיקת Security Headers');
// בדוק headers של הדף הנוכחי
console.log('Content Security Policy:', document.querySelector('meta[http-equiv="Content-Security-Policy"]'));
console.log('X-Frame-Options:', document.querySelector('meta[http-equiv="X-Frame-Options"]'));

// ===== סיכום =====
console.log('\n📊 סיכום בדיקות אבטחה');
console.log('='.repeat(50));

// בדיקות נוספות שתוכל לבצע:

console.log('\n🧪 בדיקות נוספות לביצוע:');
console.log('1. נסה לגשת לאתר ללא כניסה');
console.log('2. נסה לשנות URL לנתיבים מוגנים');
console.log('3. בדוק אם יש מידע רגיש ב-HTML source');
console.log('4. נסה להזריק קוד JavaScript בשדות טקסט');
console.log('5. בדוק אם יש cookies רגישים');

console.log('\n🔧 כלים מומלצים:');
console.log('- OWASP ZAP: בדיקות אבטחה אוטומטיות');
console.log('- Burp Suite: בדיקות חדירה ידניות');
console.log('- Firebase Security Rules Simulator');
console.log('- Lighthouse Security Audit');

console.log('\n✅ בדיקות אבטחה הושלמו!');