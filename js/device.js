// Çelimeluk - Device Identification & Multi-Account Tracking
import { getDb, ensureFirebaseReady } from './firebase-config.js';

let firestoreModules = null;
async function getFirestoreModules() {
  if (firestoreModules) return firestoreModules;
  firestoreModules = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  return firestoreModules;
}

const DEVICE_KEY = 'celimeluk_device_id';

/**
 * Tarayıcı için kalıcı ve benzersiz bir Cihaz Kimliği (Device ID) üretir veya mevcut olanı döndürür.
 * localStorage'da saklanır, dolayısıyla aynı tarayıcıda farklı maillerle giriş yapılsa bile Device ID değişmez.
 */
export function getDeviceId() {
  let deviceId = null;
  try {
    deviceId = localStorage.getItem(DEVICE_KEY);
  } catch (e) {
    // LocalStorage erişimi engellenmişse hafızada üret
  }

  if (!deviceId) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      deviceId = 'dev_' + crypto.randomUUID();
    } else {
      deviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    }
    try {
      localStorage.setItem(DEVICE_KEY, deviceId);
    } catch (e) {
      console.warn('Cihaz ID localStorage yazılamadı:', e);
    }
  }

  return deviceId;
}

/**
 * Cihazın işletim sistemi, türü ve ekran bilgilerini derler.
 */
export function getDeviceInfo() {
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  let platform = 'Bilinmeyen';
  let deviceType = 'Masaüstü';

  if (/android/i.test(ua)) {
    platform = 'Android';
    deviceType = /mobile/i.test(ua) ? 'Mobil' : 'Tablet';
  } else if (/iphone|ipod/i.test(ua)) {
    platform = 'iOS (iPhone)';
    deviceType = 'Mobil';
  } else if (/ipad/i.test(ua)) {
    platform = 'iOS (iPad)';
    deviceType = 'Tablet';
  } else if (/windows nt/i.test(ua)) {
    platform = 'Windows';
    deviceType = 'Masaüstü';
  } else if (/macintosh|mac os x/i.test(ua)) {
    platform = 'macOS';
    deviceType = 'Masaüstü';
  } else if (/linux/i.test(ua)) {
    platform = 'Linux';
    deviceType = 'Masaüstü';
  }

  const screenResolution = (typeof window !== 'undefined' && window.screen)
    ? `${window.screen.width}x${window.screen.height}`
    : 'Bilinmiyor';

  return {
    deviceId: getDeviceId(),
    platform,
    deviceType,
    screenResolution,
    language: (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'tr',
    userAgent: ua
  };
}

/**
 * Kullanıcı Google ile giriş yaptığında bu cihazın kaydını Firestore 'devices' koleksiyonunda günceller.
 * Aynı cihazdan birden fazla mail ile girildiğinde:
 * - accountEmails: [mail1, mail2, ...]
 * - hasMultipleAccounts: true
 * - accountCount: 2+
 * olarak işaretlenir.
 */
export async function recordDeviceSession(user) {
  if (!user || !user.uid) return;

  try {
    const ready = await ensureFirebaseReady();
    if (!ready) return;

    const fs = await getFirestoreModules();
    const db = getDb();
    const deviceId = getDeviceId();
    const info = getDeviceInfo();

    const deviceRef = fs.doc(db, 'devices', deviceId);
    const snap = await fs.getDoc(deviceRef);

    const email = (user.email || '').trim().toLowerCase();
    const name = user.displayName || 'Oyuncu';
    const uid = user.uid;
    const nowIso = new Date().toISOString();

    let accountEmails = email ? [email] : [];
    let accounts = [{
      uid,
      email,
      name,
      photoURL: user.photoURL || '',
      lastLogin: nowIso
    }];

    let firstSeen = fs.serverTimestamp();

    if (snap.exists()) {
      const data = snap.data();
      firstSeen = data.firstSeen || firstSeen;
      const existingAccounts = Array.isArray(data.accounts) ? data.accounts : [];
      const existingEmails = Array.isArray(data.accountEmails) ? data.accountEmails : [];

      // Mevcut hesap listesinde bu kullanıcıyı bulup güncelle, yoksa ekle
      const idx = existingAccounts.findIndex(a => a.uid === uid || (email && a.email === email));
      if (idx >= 0) {
        existingAccounts[idx] = {
          ...existingAccounts[idx],
          uid,
          email: email || existingAccounts[idx].email || '',
          name,
          photoURL: user.photoURL || existingAccounts[idx].photoURL || '',
          lastLogin: nowIso
        };
      } else {
        existingAccounts.push({
          uid,
          email,
          name,
          photoURL: user.photoURL || '',
          lastLogin: nowIso
        });
      }

      const emailSet = new Set(existingEmails);
      if (email) emailSet.add(email);
      accountEmails = Array.from(emailSet);
      accounts = existingAccounts;
    }

    const payload = {
      deviceId,
      platform: info.platform,
      deviceType: info.deviceType,
      screen: info.screenResolution,
      language: info.language,
      userAgent: info.userAgent,
      lastUid: uid,
      lastEmail: email,
      lastPlayerName: name,
      accountEmails,
      accountCount: accountEmails.length,
      hasMultipleAccounts: accountEmails.length > 1,
      accounts,
      lastActive: fs.serverTimestamp(),
      firstSeen
    };

    await fs.setDoc(deviceRef, payload, { merge: true });
    console.log(`[Cihaz Takibi] Cihaz: ${deviceId} | Hesap Sayısı: ${accountEmails.length} | Çoklu Hesap: ${accountEmails.length > 1}`);

    // Ayrıca garanti olması için players/{uid} profiline de cihaz bilgilerini kaydet
    try {
      const playerRef = fs.doc(db, 'players', uid);
      await fs.setDoc(playerRef, {
        deviceId,
        devicePlatform: info.platform,
        deviceType: info.deviceType,
        deviceScreen: info.screenResolution,
        lastActive: fs.serverTimestamp()
      }, { merge: true });
    } catch (pErr) {
      console.warn('Player profilinde cihaz güncellenirken hata:', pErr);
    }
  } catch (err) {
    console.error('Firestore [devices] yazma hatası (Firebase Console > Firestore > Rules sekmesinde "devices" koleksiyonuna izin verilmiş olmalı):', err);
  }
}
