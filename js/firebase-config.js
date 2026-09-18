// Çelimeluk - Firebase Configuration & Auth
// Replace the config values below with your Firebase project credentials

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// ⚠️ Firebase projenizin ayarlarını buraya yapıştırın
const firebaseConfig = {
  apiKey: "AIzaSyCShNRq08SEG2cYzmFq-PSkF7xz875sURg",
  authDomain: "celimeluk.firebaseapp.com",
  projectId: "celimeluk",
  storageBucket: "celimeluk.firebasestorage.app",
  messagingSenderId: "1007167357525",
  appId: "1:1007167357525:web:a573a512982b5a7ff9cadc"
};

let app = null;
let auth = null;
let db = null;
let currentUid = null;
let firebaseReady = false;
let initPromise = null;

export function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== 'YOUR_API_KEY';
}

export function initFirebase() {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase yapılandırılmamış. Skor tablosu çevrimdışı çalışacak.');
    return Promise.resolve(null);
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);

      // Anonymous sign-in
      const userCredential = await signInAnonymously(auth);
      currentUid = userCredential.user.uid;
      firebaseReady = true;
      console.log('Firebase başarıyla bağlandı. UID:', currentUid);
      return currentUid;
    } catch (err) {
      console.error('Firebase başlatma hatası:', err);
      firebaseReady = false;
      return null;
    }
  })();

  return initPromise;
}

export async function ensureFirebaseReady() {
  if (!isFirebaseConfigured()) return false;
  if (firebaseReady && currentUid) return true;
  await initFirebase();
  return firebaseReady && currentUid !== null;
}

export function getDb() {
  return db;
}

export function getUid() {
  return currentUid;
}

export function isReady() {
  return firebaseReady && currentUid !== null;
}
