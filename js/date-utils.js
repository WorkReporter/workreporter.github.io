// js/date-utils.js
// פונקציית עזר אחידה לפורמט תאריך ישראלי dd/mm/yyyy

/**
 * מציג תאריך בפורמט ישראלי dd/mm/yyyy
 * @param {*} timestamp - Firestore Timestamp, Date, string, או מספר
 * @param {string} fallback - ערך ברירת מחדל אם אין תאריך
 * @returns {string} תאריך בפורמט dd/mm/yyyy
 */
export function formatDateIL(timestamp, fallback = '') {
    if (!timestamp) return fallback;
    try {
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        if (isNaN(date.getTime())) return fallback;
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    } catch {
        return fallback;
    }
}
