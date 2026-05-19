// js/server-time.js
// זמן שרת מקורب ל-UI בלבד.
// אבטחה אמיתית עדיין נאכפת ב-Firestore Rules מול request.time.

import {
    doc,
    setDoc,
    getDocFromServer,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let serverEpochMs = null;
let performanceAtSyncMs = null;
let initPromise = null;

export async function initServerTime(db, currentUser) {
    if (!db || !currentUser?.uid) return false;

    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        try {
            const ref = doc(db, "users", currentUser.uid, "meta", "serverTimeProbe");
            const perfBefore = performance.now();

            await setDoc(ref, {
                ts: serverTimestamp(),
                updatedAt: serverTimestamp()
            }, { merge: true });

            const snap = await getDocFromServer(ref);
            const ts = snap.data()?.ts;
            
            if (!ts?.toDate) {
                throw new Error("Server timestamp was not resolved");
            }

            const perfAfter = performance.now();
            serverEpochMs = ts.toDate().getTime();
            performanceAtSyncMs = (perfBefore + perfAfter) / 2;

            return true;
        } catch (error) {
            console.warn("Could not initialize Firebase server time. Falling back to local time.", error);
            serverEpochMs = null;
            performanceAtSyncMs = null;
            return false;
        }
    })();

    return initPromise;
}

export function getTrustedNow() {
    if (serverEpochMs === null || performanceAtSyncMs === null) {
        return new Date();
    }
    const elapsedMs = performance.now() - performanceAtSyncMs;
    return new Date(serverEpochMs + elapsedMs);
}

export function hasTrustedServerTime() {
    return serverEpochMs !== null && performanceAtSyncMs !== null;
}
