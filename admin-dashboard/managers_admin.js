// נהל רשימת מנהלים ב-Firebase
// צריך לרוץ רק למי שיש הרשאות מנהל

(function() {
    'use strict';

    // פונקציות עזר לניהול מנהלים

    /**
     * הוספת מנהל חדש ל-Firebase
     * @param {Object} managerData נתוני המנהל
     * @returns {Promise<string>} מזהה המנהל שנוסף
     */
    async function addManager(managerData) {
        try {
            const managersRef = firebase.database().ref('managers');
            const newManagerRef = managersRef.push();

            const managerRecord = {
                firstName: managerData.firstName || '',
                lastName: managerData.lastName || '',
                fullName: `${managerData.firstName || ''} ${managerData.lastName || ''}`.trim(),
                email: managerData.email || '',
                createdAt: new Date().toISOString(),
                isActive: true
            };

            await newManagerRef.set(managerRecord);
            console.log('Manager added successfully:', newManagerRef.key);
            return newManagerRef.key;
        } catch (error) {
            console.error('Error adding manager:', error);
            throw error;
        }
    }

    /**
     * עדכון פרטי מנהל קיים
     * @param {string} managerId מזהה המנהל
     * @param {Object} updateData נתונים לעדכון
     * @returns {Promise<void>}
     */
    async function updateManager(managerId, updateData) {
        try {
            const managerRef = firebase.database().ref(`managers/${managerId}`);

            const updates = {
                ...updateData,
                fullName: `${updateData.firstName || ''} ${updateData.lastName || ''}`.trim(),
                updatedAt: new Date().toISOString()
            };

            await managerRef.update(updates);
            console.log('Manager updated successfully:', managerId);
        } catch (error) {
            console.error('Error updating manager:', error);
            throw error;
        }
    }

    /**
     * הסרת מנהל (סימון כלא פעיל)
     * @param {string} managerId מזהה המנהל
     * @returns {Promise<void>}
     */
    async function removeManager(managerId) {
        try {
            const managerRef = firebase.database().ref(`managers/${managerId}`);
            await managerRef.update({
                isActive: false,
                deletedAt: new Date().toISOString()
            });
            console.log('Manager deactivated successfully:', managerId);
        } catch (error) {
            console.error('Error removing manager:', error);
            throw error;
        }
    }

    /**
     * קבלת כל המנהלים הפעילים
     * @returns {Promise<Array>} רשימת המנהלים
     */
    async function getAllActiveManagers() {
        try {
            const snapshot = await firebase.database().ref('managers').once('value');
            const managers = snapshot.val() || {};

            // מסנן רק מנהלים פעילים
            const activeManagers = Object.entries(managers)
                .filter(([id, manager]) => manager.isActive !== false)
                .map(([id, manager]) => ({
                    id,
                    ...manager
                }));

            return activeManagers;
        } catch (error) {
            console.error('Error loading managers:', error);
            return [];
        }
    }

    /**
     * אתחול נתוני מנהלים ברירת מחדל
     * @returns {Promise<void>}
     */
    async function seedDefaultManagers() {
        try {
            const existingManagers = await getAllActiveManagers();
            if (existingManagers.length > 0) {
                console.log('Managers already exist, skipping seeding');
                return;
            }

            console.log('Seeding default managers...');

            const defaultManagers = [
                {
                    firstName: 'אין מנהלים רשומים למערכת',
                    lastName: '- נסה מאוחר יותר',
                    email: '-'
                }
            ];

            for (const manager of defaultManagers) {
                try {
                    await addManager(manager);
                } catch (error) {
                    console.error('Error adding default manager:', manager, error);
                }
            }

            console.log('Default managers seeded successfully');
        } catch (error) {
            console.error('Error seeding default managers:', error);
        }
    }

    /**
     * מעדכן משתמש כמנהל ב-Firebase
     * @param {string} userEmail אימייל המשתמש
     * @returns {Promise<void>}
     */
    async function promoteUserToManager(userEmail) {
        try {
            // חפש משתמש לפי אימייל
            const usersSnapshot = await firebase.database().ref('users').once('value');
            const users = usersSnapshot.val() || {};

            const userEntry = Object.entries(users).find(([id, user]) => user.email === userEmail);
            if (!userEntry) {
                throw new Error('משתמש לא נמצא');
            }

            const [userId, userData] = userEntry;

            // עדכן את המשתמש לתפקיד מנהל
            await firebase.database().ref(`users/${userId}`).update({
                position: 'מנהל',
                my_manager: '', // מנהל לא צריך מנהל
                promotedToManagerAt: new Date().toISOString()
            });

            // הוסף למנהלים אם לא קיים
            const managerData = {
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                email: userEmail
            };
            await addManager(managerData);

            console.log('User promoted to manager successfully:', userEmail);
        } catch (error) {
            console.error('Error promoting user to manager:', error);
            throw error;
        }
    }

    // חשוף פונקציות למעקב ניהול (רק למנהלים)
    if (typeof window !== 'undefined') {
        window.ManagersAdmin = {
            addManager,
            updateManager,
            removeManager,
            getAllActiveManagers,
            seedDefaultManagers,
            promoteUserToManager
        };
    }

    // אתחול אוטומטי - ננסה ליצור מנהלים ברירת מחדל כשהמערכת נטענת
    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', function() {
            // המתן קצת זמן כדי לוודא ש-Firebase מוכן
            setTimeout(async function() {
                try {
                    // נסה תמיד ליצור מנהלים ברירת מחדל
                    await seedDefaultManagers();
                } catch (error) {
                    console.log('Could not seed managers on load:', error);
                }
            }, 2000); // המתנה של 2 שניות
        });
    }

})();
