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
    totalWorkDaysPerHalfYear: 110,
    totalWorkDaysPerYear: 110,
    // Default global researchers list (seed)
    defaultResearchers: [
        "אביטל בכר",
    "אילן הלחמי",
    "אלון סלע",
    "גיאורגי שטנברג",
    "היבה אבו תאיה",
    "ויקטור אלחנתי",
    "ויקטור בלוך",
    "ילנה ויטושקין",
    "יעל זלצר",
    "יפית כהן אלחנתי",
    "יפתח קלפ",
    "נעם דוד",
    "ספי ורניק",
    "עלאא גמאל",
    "עמיחי חורש",
    "רני אריאלי"
    ],
    // One-time temporary override to allow backdating beyond one previous week
    // NOTE: These settings are now managed from Firebase (global/backdateOverride)
    // This serves as a fallback only if Firebase settings are not available
    backdateOverride: {
        enabled: false,
        // Allow backdating starting from this date (YYYY-MM-DD)
        minDate: null,
        // Allow backdating up to this date (YYYY-MM-DD) - does not affect current/previous week
        maxDate: null,
        // Permission expiration date (optional) - after this date, backdate is disabled
        permissionEndDate: null,
        // List of user IDs allowed for backdate (empty = all users)
        allowedEmployees: []
    }
};
