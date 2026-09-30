// Çelimeluk - In-Progress Game Sessions & Live Drop-off Tracker
import { getDb, ensureFirebaseReady, getCurrentUser } from './firebase-config.js';
import { getDeviceId, getDeviceInfo } from './device.js';
import { getLocalDateString } from './date-utils.js';

let firestoreModules = null;
async function getFirestoreModules() {
  if (firestoreModules) return firestoreModules;
  firestoreModules = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  return firestoreModules;
}

/**
 * Günün oyunundaki her tahmini ve canlı oyun durumunu Firestore'da
 * 'game_sessions' koleksiyonuna anlık olarak kaydeder.
 * 
 * Böylece:
 * - Oyuna başlayıp yarım bırakan kullanıcılar,
 * - Hangi kelimeleri tahmin ettikleri,
 * - Kaçıncı denemede oyundan çıktıkları,
 * - Hangi cihaz, tarayıcı ve Google hesabıyla oynadıkları
 * Firebase Console üzerinden net olarak izlenebilir.
 */
export async function trackGameSessionProgress(game, extra = {}) {
  if (!game || !game.targetWord) return;

  const ready = await ensureFirebaseReady();
  if (!ready) return;

  try {
    const fs = await getFirestoreModules();
    const db = getDb();
    if (!db) return;

    const user = getCurrentUser();
    const deviceId = getDeviceId();
    const info = getDeviceInfo();
    const date = getLocalDateString();

    // Doküman kimliği: Giriş yapmışsa `${user.uid}_${date}`, misafirse `${deviceId}_${date}`
    const sessionDocId = `${user?.uid || deviceId}_${date}`;
    const sessionRef = fs.doc(db, 'game_sessions', sessionDocId);

    const isWon = Boolean(game.won);
    const isLost = Boolean(game.lost);
    const isGameOver = Boolean(game.isGameOver);

    let status = 'in_progress';
    if (isWon) status = 'completed_won';
    else if (isLost) status = 'completed_lost';

    const cleanGuesses = (game.guesses || []).map((g, idx) => {
      const word = g.word || (g.letters ? g.letters.map(l => l.letter).join('') : '');
      return {
        guessNumber: idx + 1,
        word: word.toLocaleUpperCase('tr-TR'),
        letters: g.letters || []
      };
    });

    const guessWords = cleanGuesses.map(g => g.word);

    const playerName = user?.displayName || localStorage.getItem('celimeluk_player_name') || 'Misafir Oyuncu';
    const email = user?.email || null;

    const payload = {
      sessionDocId,
      date,
      dayNumber: game.dayNumber || null,
      targetWord: game.targetWord,
      guessCount: cleanGuesses.length,
      maxGuesses: 6,
      guessWords, // Örn: ["KALEM", "KAVUN", "KASAP"]
      guesses: cleanGuesses,
      status, // 'in_progress' | 'completed_won' | 'completed_lost'
      completed: isGameOver,
      won: isWon,
      lost: isLost,
      elapsedSeconds: Math.round(game.getElapsedSeconds() * 10) / 10,
      startTime: game.startTime || null,
      endTime: game.endTime || null,
      lastAction: extra.action || (isGameOver ? 'game_finished' : 'guess_submitted'),

      // Kullanıcı & Hesap Kimliği
      isLoggedIn: Boolean(user),
      uid: user?.uid || null,
      email,
      playerName,
      photoURL: user?.photoURL || '',

      // Cihaz & Donanım Kimliği
      deviceId,
      deviceFingerprint: info.deviceFingerprint,
      browserName: info.browserName,
      devicePlatform: info.platform,
      deviceType: info.deviceType,
      screen: info.screenResolution,

      updatedAt: fs.serverTimestamp()
    };

    // İlk tahminde oluşturulma zamanını ekle
    if (extra.isFirstGuess || cleanGuesses.length === 1) {
      payload.createdAt = fs.serverTimestamp();
    }

    await fs.setDoc(sessionRef, payload, { merge: true });
    console.log(`[Canlı Oturum] Doc: ${sessionDocId} | Durum: ${status} | Tahmin: ${cleanGuesses.length}/6 (${guessWords.join(', ')})`);
  } catch (err) {
    console.warn('Oyun oturumu kaydedilemedi (Firestore):', err.message);
  }
}

/**
 * Oyuncu sayfayı kapattığında, sekmeyi arka plana attığında
 * yarım kalan oyun oturumunu Firestore'da 'tab_hidden_or_left' olarak damgalar.
 */
export function setupSessionLifecycleListeners(getGameFn, getModeFn) {
  const handleLeave = () => {
    if (typeof getModeFn === 'function' && getModeFn() !== 'daily') return;
    const game = getGameFn();
    if (game && !game.isGameOver && game.guesses && game.guesses.length > 0) {
      trackGameSessionProgress(game, { action: 'tab_hidden_or_left' });
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      handleLeave();
    }
  });

  window.addEventListener('pagehide', handleLeave);
  window.addEventListener('beforeunload', handleLeave);
}
