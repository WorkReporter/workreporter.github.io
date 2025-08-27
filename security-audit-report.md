# דוח אבטחה - מערכת דיווח שעות וולקני

## 🔴 בעיות קריטיות שדורשות תיקון מיידי

### 1. חשיפת API Key
**בעיה:** ה-API Key של Firebase מופיע בקוד JavaScript
**סיכון:** מתקיף יכול להשתמש ב-API Key לגישה למסד הנתונים
**תיקון:**
- השתמש ב-Environment Variables בשרת
- הגבל את ה-API Key רק לדומיין שלך ב-Firebase Console
- שקול שימוש ב-Custom Claims במקום אימות בצד הלקוח

### 2. אימות חלש
**בעיה:** אימות מבוסס אימייל/סיסמה בלבד
**תיקון:**
- הוסף אימות דו-שלבי (2FA)
- הוסף אימות מבוסס ארגון (SSO)
- הגבל כניסות לפי IP

### 3. חשיפת מידע רגיש
**בעיה:** כתובת האימייל של המנהל מופיעה בקוד
**תיקון:**
- השתמש ב-Custom Claims של Firebase
- הסתר את האימייל מהקוד

## 🟡 בעיות בינוניות

### 4. לוגיקת זיהוי מנהל
**בעיה:** מבוססת על אימייל בלבד
**תיקון:**
```javascript
// במקום בדיקת אימייל ישירה
const isAdmin = user.email === adminEmail;

// השתמש ב-Custom Claims
const isAdmin = user.customClaims?.admin === true;
```

### 5. חוסר הגנה מפני CSRF
**תיקון:**
- הוסף CSRF tokens לכל הפעולות
- השתמש ב-SameSite cookies

### 6. Rate Limiting
**תיקון:**
- הגבל ניסיונות כניסה
- הגבל מספר בקשות לדקה

## 🟢 כללי Firebase Database - ניתוח

### חיובי:
✅ אימות נדרש לכל הפעולות  
✅ הפרדה נכונה בין משתמשים  
✅ הגבלת כתיבה למשתמשים שלהם בלבד  
✅ גישה למנהל מוגבלת לאימייל ספציפי  

### שיפורים מוצעים:
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

## 🧪 בדיקות אבטחה לביצוע

### בדיקות Console:

#### 1. בדיקת חשיפת מידע
```javascript
// בדוק אם ניתן לגשת למידע רגיש
console.log(window.APP_CONFIG);
console.log(window.auth?.currentUser);

// בדוק אם ניתן לגשת למסד הנתונים ישירות
const db = firebase.database();
db.ref('users').once('value').then(snapshot => {
  console.log('גישה למשתמשים:', snapshot.val());
});
```

#### 2. בדיקת הרשאות
```javascript
// נסה לגשת לנתונים של משתמש אחר
const otherUserId = 'some-other-user-id';
db.ref(`users/${otherUserId}`).once('value').then(snapshot => {
  console.log('גישה למשתמש אחר:', snapshot.val());
}).catch(error => {
  console.log('נחסם בהצלחה:', error);
});
```

#### 3. בדיקת אימות מנהל
```javascript
// בדוק אם משתמש רגיל יכול לגשת לנתוני מנהל
db.ref('users').once('value').then(snapshot => {
  console.log('גישה לכל המשתמשים:', snapshot.val());
}).catch(error => {
  console.log('נחסם בהצלחה:', error);
});
```

#### 4. בדיקת CSRF
```javascript
// נסה לבצע פעולה ללא אימות
fetch('/api/reports', {
  method: 'POST',
  body: JSON.stringify({date: '2024-01-01', hours: 8})
}).then(response => {
  console.log('תגובת CSRF:', response);
});
```

#### 5. בדיקת XSS
```javascript
// נסה להזריק קוד JavaScript
const maliciousInput = '<script>alert("XSS")</script>';
// הזן את הקוד הזה בשדות טקסט באתר
```

### בדיקות נוספות:

#### 6. בדיקת Network
```javascript
// בדוק בקשות רשת
console.log('בקשות רשת:', performance.getEntriesByType('resource'));
```

#### 7. בדיקת Local Storage
```javascript
// בדוק אם מידע רגיש נשמר
console.log('Local Storage:', localStorage);
console.log('Session Storage:', sessionStorage);
```

## 📋 תוכנית פעולה

### שלב 1 - תיקונים מיידיים (24 שעות):
1. הגבל את ה-API Key לדומיין שלך
2. הוסף Rate Limiting
3. הסתר את אימייל המנהל מהקוד

### שלב 2 - שיפורים (שבוע):
1. הוסף Custom Claims למנהלים
2. הוסף CSRF Protection
3. שיפור כללי Firebase Database

### שלב 3 - אבטחה מתקדמת (חודש):
1. הוסף 2FA
2. הוסף SSO
3. הוסף Security Headers
4. ביצוע בדיקות חדירה מקצועיות

## 🔧 כלים מומלצים לבדיקות:

1. **OWASP ZAP** - בדיקות אבטחה אוטומטיות
2. **Burp Suite** - בדיקות חדירה ידניות
3. **Firebase Security Rules Simulator** - בדיקת כללי אבטחה
4. **Lighthouse Security Audit** - בדיקות אבטחה בסיסיות

## 📞 איש קשר למקרה חירום:
במקרה של פריצה או חשד לפריצה:
1. חסום מיד את ה-API Key
2. שנה סיסמאות
3. בדוק לוגים של Firebase
4. פנה לאנשי אבטחת מידע