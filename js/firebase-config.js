// Çelimeluk - Firebase Configuration & Google Auth

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

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
let currentUser = null;
let firebaseReady = false;
let initPromise = null;

// Auth state change listeners
const authListeners = [];

export function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== 'YOUR_API_KEY';
}

export function initFirebase() {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase yapılandırılmamış.');
    return Promise.resolve(null);
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);

      // Check for redirect result first (mobile Google sign-in)
      try {
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult?.user) {
          currentUser = redirectResult.user;
          firebaseReady = true;
          console.log('Google redirect girişi başarılı:', currentUser.displayName);
          notifyAuthListeners();
          return currentUser.uid;
        }
      } catch (redirectErr) {
        console.warn('Redirect result check:', redirectErr.message);
      }

      // Listen continuously to auth state changes
      return new Promise((resolve) => {
        let firstCheckDone = false;
        onAuthStateChanged(auth, (user) => {
          currentUser = user;
          firebaseReady = true;
          if (user) {
            console.log('Firebase oturumu aktif:', user.displayName || user.uid);
          } else {
            console.log('Firebase oturumu yok (misafir).');
          }
          notifyAuthListeners();
          if (!firstCheckDone) {
            firstCheckDone = true;
            resolve(user ? user.uid : null);
          }
        });
      });
    } catch (err) {
      console.error('Firebase başlatma hatası:', err);
      firebaseReady = false;
      return null;
    }
  })();

  return initPromise;
}

// Guest Sign-In (fallback for players who skip Google)
export async function signInAsGuest() {
  if (!auth) await initFirebase();
  try {
    const cred = await signInAnonymously(auth);
    currentUser = cred.user;
    firebaseReady = true;
    notifyAuthListeners();
    console.log('Misafir girişi yapıldı:', currentUser.uid);
    return currentUser;
  } catch (err) {
    console.warn('Misafir giriş hatası:', err);
    return null;
  }
}

// Google Sign-In
export async function signInWithGoogle() {
  if (!auth) await initFirebase();

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    firebaseReady = true;
    notifyAuthListeners();
    console.log('Google girişi başarılı:', currentUser.displayName);
    return currentUser;
  } catch (err) {
    console.warn('Google giriş denemesi kodu:', err.code, err.message);
    if (err.code === 'auth/popup-blocked') {
      console.log('Açılır pencere engellendi, redirect deneniyor...');
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

// Sign out
export async function signOutUser() {
  if (!auth) return;
  try {
    await signOut(auth);
    currentUser = null;
    notifyAuthListeners();
    console.log('Kullanıcı çıkış yaptı.');
  } catch (err) {
    console.error('Çıkış hatası:', err);
  }
}

// Auth state listener
export function onAuthChange(callback) {
  authListeners.push(callback);
  if (currentUser !== undefined) {
    callback(currentUser);
  }
}

function notifyAuthListeners() {
  for (const cb of authListeners) {
    try { cb(currentUser); } catch (e) { console.error(e); }
  }
}

export async function ensureFirebaseReady() {
  if (!isFirebaseConfigured()) return false;
  if (firebaseReady && currentUser) return true;
  await initFirebase();
  if (!currentUser) {
    await signInAsGuest();
  }
  return firebaseReady && currentUser !== null;
}

export function getDb() { return db; }
export function getUid() { return currentUser?.uid || null; }
export function getDisplayName() { return currentUser?.displayName || null; }
export function getPhotoURL() { return currentUser?.photoURL || null; }
export function isSignedIn() { return currentUser !== null && !currentUser.isAnonymous; }
export function isReady() { return firebaseReady && currentUser !== null; }
export function getCurrentUser() { return currentUser; }
