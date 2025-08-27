# תיקונים מיידיים לאבטחה - מערכת דיווח שעות וולקני

## 🚨 תיקונים קריטיים לביצוע מיידי

### 1. הגבלת API Key (דחוף!)

#### שלב 1: היכנס ל-Firebase Console
1. לך ל-https://console.firebase.google.com
2. בחר את הפרויקט שלך: `work-report-volcani`
3. לך ל-Project Settings (ההיליפס בצד שמאל למעלה)

#### שלב 2: הגבל את ה-API Key
1. בחר בטאב "General"
2. גלול למטה לחלק "Your apps"
3. בחר את האפליקציה שלך
4. לחץ על "Show configuration"
5. העתק את ה-API Key

#### שלב 3: הגדר הגבלות ב-Google Cloud Console
1. לך ל-https://console.cloud.google.com
2. בחר את הפרויקט שלך
3. לך ל-APIs & Services > Credentials
4. חפש את ה-API Key שלך
5. לחץ עליו לעריכה
6. תחת "Application restrictions" בחר "HTTP referrers (web sites)"
7. הוסף את הדומיין שלך: `*.volcani.agri.gov.il/*`
8. תחת "API restrictions" בחר "Restrict key"
9. בחר רק את ה-APIs הנדרשים:
   - Firebase Authentication API
   - Firebase Realtime Database API
   - Firebase Hosting API

### 2. הסתרת אימייל המנהל

#### עדכן את הקובץ `assets/js/config.js`:
```javascript
// Configuration and constants
window.APP_CONFIG = {
    firebaseConfig: {
        apiKey: "AIzaSyDpzAnHPl8trZDQwC-G5twRWSwdweko_T8",
        authDomain: "work-report-volcani.firebaseapp.com",
        projectId: "work-report-volcani",
        storageBucket: "work-report-volcani.firebasestorage.app",
        messagingSenderId: "569559789764",
        appId: "1:569559789764:web:d11b9c0e43ff78a66dd991",
        measurementId: "G-M5Z4R1FB40",
        databaseURL: "https://work-report-volcani-default-rtdb.firebaseio.com/"
    },
    hoursPerDay: 8,
    // הסתר את האימייל - השתמש ב-Custom Claims במקום
    // adminEmail: 'salzer@volcani.agri.gov.il', // הוסף // בתחילת השורה
    defaultResearchers: [
        "יעל זלצר",
        "גיאורגי שטנברג",
        "ויקטור בלוך",
        "יפתח קלפ",
        "ספי ורניק",
        "אלון סלע"
    ],
};
```

#### עדכן את הקובץ `assets/js/app.js`:
```javascript
// במקום השורה הזו:
// isAdmin = String(user.email || '').toLowerCase() === String(adminEmail).toLowerCase();

// השתמש בזה:
isAdmin = user.email === 'salzer@volcani.agri.gov.il';
```

### 3. הוספת Custom Claims למנהל

#### צור קובץ חדש `admin-setup.js`:
```javascript
// קובץ חד פעמי להגדרת Custom Claims למנהל
// הרץ את זה פעם אחת בלבד!

const admin = require('firebase-admin');

// אתחל את Firebase Admin SDK
const serviceAccount = require('./path/to/serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://work-report-volcani-default-rtdb.firebaseio.com/"
});

// הגדר Custom Claims למנהל
async function setAdminClaims() {
  try {
    // מצא את המשתמש לפי אימייל
    const userRecord = await admin.auth().getUserByEmail('salzer@volcani.agri.gov.il');
    
    // הגדר Custom Claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      admin: true,
      role: 'admin'
    });
    
    console.log('✅ Custom Claims הוגדרו בהצלחה למנהל');
  } catch (error) {
    console.error('❌ שגיאה בהגדרת Custom Claims:', error);
  }
}

setAdminClaims();
```

### 4. עדכון כללי Firebase Database

#### עדכן את כללי האבטחה ב-Firebase Console:
```json
{
  "rules": {
    ".read": false,
    ".write": false,
    
    "users": {
      ".read": "auth != null && (auth.token.admin === true || auth.uid === $uid)",
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || auth.token.admin === true)",
        ".write": "auth != null && auth.uid === $uid",
        ".validate": "newData.hasChildren(['firstName', 'lastName', 'email'])"
      }
    },
    
    "reports": {
      ".read": "auth != null && auth.token.admin === true",
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || auth.token.admin === true)",
        ".write": "auth != null && auth.uid === $uid",
        ".validate": "newData.hasChildren(['date', 'entries'])"
      }
    },
    
    "global": {
      "researchers": {
        ".read": "auth != null",
        ".write": "auth != null && auth.token.admin === true"
      }
    }
  }
}
```

### 5. הוספת Security Headers

#### הוסף ל-HTML head:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self' https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;">
<meta http-equiv="X-Frame-Options" content="DENY">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
```

### 6. הוספת Rate Limiting

#### הוסף קובץ `rate-limiter.js`:
```javascript
// Rate Limiting בסיסי
class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = new Map();
  }

  isAllowed(userId) {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    
    // הסר בקשות ישנות
    const recentRequests = userRequests.filter(time => now - time < this.timeWindow);
    
    if (recentRequests.length >= this.maxRequests) {
      return false;
    }
    
    // הוסף בקשה חדשה
    recentRequests.push(now);
    this.requests.set(userId, recentRequests);
    
    return true;
  }
}

// השתמש ב-Rate Limiter
const rateLimiter = new RateLimiter(10, 60000); // 10 בקשות לדקה

// בדוק לפני כל פעולה
function checkRateLimit(userId) {
  if (!rateLimiter.isAllowed(userId)) {
    throw new Error('יותר מדי בקשות. נסה שוב מאוחר יותר.');
  }
}
```

## 📋 רשימת בדיקה

### לפני יישום:
- [ ] גבה את כל הקבצים
- [ ] בדוק שהאתר עובד כרגיל
- [ ] הכנת Service Account Key ל-Firebase Admin

### אחרי יישום:
- [ ] בדוק שהאתר עובד
- [ ] בדוק שהמנהל יכול להתחבר
- [ ] הרץ את בדיקות האבטחה
- [ ] בדוק שהמשתמשים הרגילים לא יכולים לגשת לנתוני מנהל

### בדיקות נוספות:
- [ ] נסה לגשת לאתר מדומיין אחר
- [ ] נסה לבצע פעולות ללא כניסה
- [ ] בדוק שהמידע הרגיש לא נחשף

## 🚨 במקרה חירום

אם יש חשד לפריצה:
1. חסום מיד את ה-API Key ב-Google Cloud Console
2. שנה סיסמאות לכל המשתמשים
3. בדוק לוגים ב-Firebase Console
4. פנה לאנשי אבטחת מידע

## 📞 תמיכה

לשאלות נוספות או בעיות:
- Firebase Documentation: https://firebase.google.com/docs
- Firebase Security Rules: https://firebase.google.com/docs/database/security
- Google Cloud Console: https://console.cloud.google.com