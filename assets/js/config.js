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
    // Toggle enabled to true when you want to allow reporting further back
    // Optionally set minDate (YYYY-MM-DD) to restrict how far back is allowed
    backdateOverride: {
        enabled: true,
        // Allow backdating starting from Sep 1, 2025 (adjust as needed)
        minDate: '2025-12-01'
    }
};
