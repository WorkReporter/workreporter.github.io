// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDaZoVnU8Yq9zDMTyANQm17RIoCL9znmJI",
  authDomain: "rsc-tgi-lzp.firebaseapp.com",
  projectId: "rsc-tgi-lzp",
  storageBucket: "rsc-tgi-lzp.firebasestorage.app",
  messagingSenderId: "422701013051",
  appId: "1:422701013051:web:43aa3f6d34562cc920e41e"
};

// init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };