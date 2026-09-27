// Çelimeluk - Advanced Device Identification & Multi-Account Tracking
import { getDb, ensureFirebaseReady } from './firebase-config.js';

let firestoreModules = null;
async function getFirestoreModules() {
  if (firestoreModules) return firestoreModules;
  firestoreModules = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  return firestoreModules;
}

const DEVICE_KEY = 'celimeluk_device_id';

function getCookie(name) {
  try {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    if (match) return decodeURIComponent(match[2]);
  } catch (e) {}
  return null;
}

function setCookie(name, value, days = 730) {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (e) {}
}

/**
 * Tarayıcı için kalıcı ve benzersiz bir Cihaz Kimliği (Device ID) üretir veya mevcut olanı döndürür.
 * Çifte depolama (localStorage + Cookie) kullanır, böylece önbellek temizlemelerine karşı çok daha dirençlidir.
 */
export function getDeviceId() {
  let deviceId = null;

  // 1. Önce localStorage kontrolü
  try {
    deviceId = localStorage.getItem(DEVICE_KEY);
  } catch (e) {}

  // 2. localStorage boşsa kalıcı cookie kontrolü
  if (!deviceId) {
    deviceId = getCookie(DEVICE_KEY);
    if (deviceId) {
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }

  // 3. Hiçbiri yoksa yeni ID üret ve her iki yere de yaz
  if (!deviceId) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      deviceId = 'dev_' + crypto.randomUUID();
    } else {
      deviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    }
    try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    setCookie(DEVICE_KEY, deviceId);
  } else {
    // Cookie'de yoksa cookie'yi de güncelle
    if (!getCookie(DEVICE_KEY)) {
      setCookie(DEVICE_KEY, deviceId);
    }
  }

  return deviceId;
}

/**
 * Donanım düzeyinde Cihaz Parmak İzi (Hardware Fingerprint) hesaplar.
 * Farklı tarayıcılar (Chrome vs WhatsApp WebView) veya Gizli Sekmede bile donanım özellikleri (ekran, GPU, çekirdek)
 * aynı kaldığı için bu parmak izi aynı cihazı tespit etmeye yardımcı olur.
 */
export function getDeviceFingerprint() {
  try {
    const parts = [];

    // 1. Ekran & Çözünürlük & Piksel Yoğunluğu
    if (typeof window !== 'undefined' && window.screen) {
      parts.push(
        window.screen.width,
        window.screen.height,
        window.screen.colorDepth,
        window.devicePixelRatio || 1
      );
    }

    // 2. Donanım Özellikleri
    if (typeof navigator !== 'undefined') {
      parts.push(
        navigator.hardwareConcurrency || 0,
        navigator.deviceMemory || 0,
        navigator.platform || '',
        navigator.maxTouchPoints || 0
      );
    }

    // 3. Zaman Dilimi
    try {
      parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    } catch (e) {}

    // 4. WebGL GPU Chipset / Renderer
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          parts.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
        }
      }
    } catch (e) {}

    // 5. Canvas Çizim İmzası
    try {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 40;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = '#9B72CF';
        ctx.fillText('Çelimeluk_fp', 4, 20);
        parts.push(c.toDataURL().slice(-40));
      }
    } catch (e) {}

    // Hash oluştur
    const str = parts.join('###');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return 'fp_' + Math.abs(hash).toString(36);
  } catch (e) {
    return 'fp_unknown';
  }
}

/**
 * GPU Grafik Kartı / Çipset adını döndürür (Örn: Adreno 640, Mali-G78, Apple GPU, Intel Iris vb.)
 */
export function getGpuRenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Bilinmiyor';
      }
    }
  } catch (e) {}
  return 'Bilinmiyor';
}

/**
 * Kullanılan tarayıcının adını ve WhatsApp/sosyal medya içi tarayıcı olup olmadığını belirler.
 */
export function getBrowserName() {
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp İçi Tarayıcı';
  if (/FB_IAB|FBAN|FBAV/i.test(ua)) return 'Facebook İçi Tarayıcı';
  if (/Instagram/i.test(ua)) return 'Instagram İçi Tarayıcı';
  if (/Edg/i.test(ua)) return 'Microsoft Edge';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) return 'Google Chrome';
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Apple Safari';
  if (/Firefox/i.test(ua)) return 'Mozilla Firefox';
  if (/Opera|OPR/i.test(ua)) return 'Opera';
  return 'Diğer Tarayıcı';
}

/**
 * Cihazın işletim sistemi, türü ve donanım bilgilerini derler.
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
    deviceFingerprint: getDeviceFingerprint(),
    gpuRenderer: getGpuRenderer(),
    browserName: getBrowserName(),
    platform,
    deviceType,
    screenResolution,
    language: (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'tr',
    userAgent: ua
  };
}

/**
 * Kullanıcı Google ile giriş yaptığında bu cihazın kaydını Firestore 'devices' koleksiyonunda günceller.
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
      deviceFingerprint: info.deviceFingerprint,
      gpuRenderer: info.gpuRenderer,
      browserName: info.browserName,
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
    console.log(`[Cihaz Takibi] Cihaz: ${deviceId} (FP: ${info.deviceFingerprint}) | Hesap Sayısı: ${accountEmails.length} | Çoklu Hesap: ${accountEmails.length > 1}`);

    // Garanti olması için players/{uid} profiline de cihaz bilgilerini kaydet
    try {
      const playerRef = fs.doc(db, 'players', uid);
      await fs.setDoc(playerRef, {
        deviceId,
        deviceFingerprint: info.deviceFingerprint,
        browserName: info.browserName,
        gpuRenderer: info.gpuRenderer,
        devicePlatform: info.platform,
        deviceType: info.deviceType,
        deviceScreen: info.screenResolution,
        lastActive: fs.serverTimestamp()
      }, { merge: true });
    } catch (pErr) {
      console.warn('Player profilinde cihaz güncellenirken hata:', pErr);
    }
  } catch (err) {
    console.error('Firestore [devices] yazma hatası (Firebase Console > Firestore > Rules sekmesinde "devices" koleksiyonuna izin verilmeli):', err);
  }
}
