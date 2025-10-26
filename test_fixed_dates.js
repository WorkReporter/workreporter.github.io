// Test the fixed getSundayOfWeek function

// Fixed getSundayOfWeek function
function getSundayOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - day);
    return sunday;
}

// Test functions
function isInCurrentWeek(date) {
    const today = new Date();
    const currentWeekStart = getSundayOfWeek(today);
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
    return date >= currentWeekStart && date <= currentWeekEnd;
}

function isInPreviousWeek(date) {
    const today = new Date();
    const currentWeekStart = getSundayOfWeek(today);
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(currentWeekStart.getDate() - 7);
    const previousWeekEnd = new Date(previousWeekStart);
    previousWeekEnd.setDate(previousWeekStart.getDate() + 6);
    return date >= previousWeekStart && date <= previousWeekEnd;
}

function canCreateNewReport(date) {
    if (isInCurrentWeek(date)) {
        return { allowed: true, message: '' };
    }
    if (isInPreviousWeek(date)) {
        return { allowed: true, message: 'דיווח לשבוע קודם - ניתן רק להוסיף דיווח חדש' };
    }
    return {
        allowed: false,
        message: 'לא ניתן לדווח יותר משבוע אחורה'
    };
}

// Test with September 3, 2025 (Wednesday) as today
// Override Date constructor to simulate specific date
const originalDate = Date;
global.Date = class extends Date {
    constructor(...args) {
        if (args.length === 0) {
            super(2025, 8, 3); // September 3, 2025
        } else {
            super(...args);
        }
    }
    static now() {
        return new originalDate(2025, 8, 3).getTime();
    }
};

console.log('=== TESTING WITH FIXED FUNCTION ===');
console.log('Simulated today: September 3, 2025 (Wednesday)');

// Test target date: August 24, 2025 (Sunday)
const targetDate = new Date(2025, 7, 24); // August 24, 2025
console.log('Target date:', targetDate.toDateString(), '(day of week:', targetDate.getDay(), ')');

const result = canCreateNewReport(targetDate);
console.log('Can create report?', result.allowed);
console.log('Message:', result.message);

console.log('\n=== DETAILED BREAKDOWN ===');
console.log('Is in current week?', isInCurrentWeek(targetDate));
console.log('Is in previous week?', isInPreviousWeek(targetDate));

// Show the week boundaries
const today = new Date();
const currentWeekStart = getSundayOfWeek(today);
const currentWeekEnd = new Date(currentWeekStart);
currentWeekEnd.setDate(currentWeekStart.getDate() + 6);

const previousWeekStart = new Date(currentWeekStart);
previousWeekStart.setDate(currentWeekStart.getDate() - 7);
const previousWeekEnd = new Date(previousWeekStart);
previousWeekEnd.setDate(previousWeekStart.getDate() + 6);

console.log('\nCurrent week:', currentWeekStart.toDateString(), '-', currentWeekEnd.toDateString());
console.log('Previous week:', previousWeekStart.toDateString(), '-', previousWeekEnd.toDateString());

// Test a few more dates for validation
console.log('\n=== ADDITIONAL TESTS ===');
const testDates = [
    new Date(2025, 8, 1), // September 1, 2025 (Sunday - current week)
    new Date(2025, 7, 25), // August 25, 2025 (Monday - previous week)
    new Date(2025, 7, 17), // August 17, 2025 (Sunday - two weeks ago)
];

testDates.forEach(date => {
    const res = canCreateNewReport(date);
    console.log(`${date.toDateString()}: ${res.allowed ? 'ALLOWED' : 'DENIED'} - ${res.message}`);
});

// Reset Date
global.Date = originalDate;
