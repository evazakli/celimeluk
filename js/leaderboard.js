// Çelimeluk - Leaderboard Module with Analytical Ranking
import { getDb, getUid, getEmail, isSignedIn, ensureFirebaseReady } from './firebase-config.js';
import { getLocalDateString } from './date-utils.js';

let firestoreModules = null;

async function getFirestoreModules() {
  if (firestoreModules) return firestoreModules;
  firestoreModules = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  return firestoreModules;
}

export function normalizePlayerName(name) {
  return (name || '').trim().toLocaleLowerCase('tr-TR');
}

/**
 * Analitik Çelimeluk Puanlama Algoritması (0 - 1000 Puan)
 * - Tahmin Verimliliği (Maks 600 Puan): Erken tahminleri ödüllendirir
 * - Hız Bonusu (Maks 400 Puan): Hızlı analitik düşünmeyi eksponansiyel eğriyle puanlar
 */
export function calculateGameScore(won, guesses, time) {
  if (!won) return 0;

  const guessScores = { 1: 600, 2: 500, 3: 420, 4: 350, 5: 280, 6: 200 };
  const baseGuessScore = guessScores[guesses] || 200;

  const t = Math.max(1, Number(time) || 60);
  const timeBonus = Math.max(20, Math.round(400 * Math.exp(-t / 75)));

  return baseGuessScore + timeBonus;
}

// Check if user already completed today's game on any device
export async function fetchUserDailyScore({ uid, date, dayNumber }) {
  const ready = await ensureFirebaseReady();
  if (!ready || !uid) return null;

  try {
    const fs = await getFirestoreModules();
    const db = getDb();

    const googleDocRef = fs.doc(db, 'scores', `${uid}_${date}`);
    const googleSnap = await fs.getDoc(googleDocRef);
    if (googleSnap.exists()) {
      const data = googleSnap.data();
      if (dayNumber !== undefined && data.dayNumber !== undefined && Number(data.dayNumber) !== Number(dayNumber)) {
        console.warn('Bulunan skor bugünün dayNumber ile eşleşmiyor:', data.dayNumber, 'beklenen:', dayNumber);
        return null;
      }
      return { docId: googleSnap.id, ...data };
    }

    return null;
  } catch (err) {
    console.warn('fetchUserDailyScore hatası:', err);
    return null;
  }
}

// Submit a score after game completion (Google-only, idempotent)
export async function submitScore({ playerName, photoURL, date, dayNumber, guesses, time, won, gameState }) {
  const ready = await ensureFirebaseReady();
  if (!ready || !isSignedIn()) {
    console.warn('Google oturumu olmadığı için skor kaydedilemedi.');
    return null;
  }

  try {
    const fs = await getFirestoreModules();
    const db = getDb();
    const uid = getUid();
    const userEmail = getEmail();

    if (!uid) {
      console.warn('Google kullanıcı kimliği bulunamadı, skor kaydedilmedi.');
      return null;
    }

    const cleanGuesses = Number(guesses) || 0;
    const cleanTime = Math.round((Number(time) || 0) * 100) / 100;
    const calculatedPoints = calculateGameScore(won, cleanGuesses, cleanTime);

    const docId = `${uid}_${date}`;
    const docRef = fs.doc(db, 'scores', docId);

    // Çapraz cihaz koruması: bu kullanıcının bugünkü skoru zaten var mı?
    const existingSnap = await fs.getDoc(docRef);
    if (existingSnap.exists()) {
      console.log('Bugünkü skor zaten kaydedilmiş. Çapraz cihaz koruması devrede, mükerrer kayıt engellendi:', docId);
      return { status: 'already_exists', docId, data: existingSnap.data() };
    }

    const scoreData = {
      uid,
      authProvider: 'google',
      email: userEmail || '',
      playerName: playerName || 'Google Oyuncusu',
      photoURL: photoURL || '',
      date,
      dayNumber,
      guesses: cleanGuesses,
      time: cleanTime,
      won: Boolean(won),
      points: calculatedPoints,
      gameState: gameState || null,
      timestamp: fs.serverTimestamp()
    };

    await fs.setDoc(docRef, scoreData);
    console.log('Skor Firestore’a başarıyla kaydedildi:', docId, scoreData);

    await updatePlayerProfile(uid, playerName, photoURL, won, cleanGuesses, calculatedPoints);

    return { status: 'saved', docId, data: scoreData };
  } catch (err) {
    console.error('Skor kaydetme hatası (Firestore):', err);
    return null;
  }
}


async function updatePlayerProfile(profileId, playerName, photoURL, won, guesses, points) {
  const ready = await ensureFirebaseReady();
  if (!ready || !profileId) return;

  try {
    const fs = await getFirestoreModules();
    const db = getDb();
    const playerRef = fs.doc(db, 'players', profileId);
    const playerSnap = await fs.getDoc(playerRef);

    const today = getLocalDateString();
    let data;

    if (playerSnap.exists()) {
      data = playerSnap.data();
      data.name = playerName;
      if (photoURL) data.photoURL = photoURL;
      data.totalGames = (data.totalGames || 0) + 1;
      data.totalWins = (data.totalWins || 0) + (won ? 1 : 0);
      data.totalPoints = (data.totalPoints || 0) + (points || 0);

      const lastPlayed = data.lastPlayedDate || '';
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getLocalDateString(yesterday);

      if (won) {
        if (lastPlayed === yesterdayStr) {
          data.currentStreak = (data.currentStreak || 0) + 1;
        } else if (lastPlayed !== today) {
          data.currentStreak = 1;
        }
      } else {
        data.currentStreak = 0;
      }

      data.maxStreak = Math.max(data.maxStreak || 0, data.currentStreak || 0);
      data.lastPlayedDate = today;
    } else {
      data = {
        name: playerName,
        photoURL: photoURL || '',
        totalGames: 1,
        totalWins: won ? 1 : 0,
        totalPoints: points || 0,
        currentStreak: won ? 1 : 0,
        maxStreak: won ? 1 : 0,
        lastPlayedDate: today
      };
    }

    await fs.setDoc(playerRef, data);
  } catch (err) {
    console.error('Oyuncu profili güncellenemedi:', err);
  }
}

// Fetch leaderboard data
export async function getLeaderboard(period = 'daily') {
  const ready = await ensureFirebaseReady();
  if (!ready) {
    console.warn('Firebase hazır değil, sıralama tablosu getirilemedi.');
    return [];
  }

  try {
    const fs = await getFirestoreModules();
    const db = getDb();

    const now = new Date();
    let startDate;

    if (period === 'daily') {
      startDate = getLocalDateString(now);
    } else if (period === 'weekly') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      startDate = getLocalDateString(d);
    } else {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      startDate = getLocalDateString(d);
    }

    let q;
    if (period === 'daily') {
      q = fs.query(
        fs.collection(db, 'scores'),
        fs.where('date', '==', startDate),
        fs.limit(100)
      );
    } else {
      q = fs.query(
        fs.collection(db, 'scores'),
        fs.where('date', '>=', startDate),
        fs.limit(400)
      );
    }

    const snapshot = await fs.getDocs(q);
    const scores = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      const rawGuesses = Number(d.guesses) || 0;
      const rawTime = Number(d.time) || 0;
      const points = d.points || calculateGameScore(d.won, rawGuesses, rawTime);

      scores.push({
        id: doc.id,
        ...d,
        guesses: rawGuesses,
        time: rawTime,
        points,
      });
    });

    if (period === 'daily') {
      // Günlük Analitik Sıralama: En yüksek Puan -> En az deneme -> En kısa süre
      scores.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (a.guesses > 0 && b.guesses > 0 && a.guesses !== b.guesses) return a.guesses - b.guesses;
        return a.time - b.time;
      });
      return scores;
    }

    // Haftalık ve Aylık için kümülatif lig analitiği
    return aggregateScores(scores);
  } catch (err) {
    console.error('Sıralama yükleme hatası:', err);
    return [];
  }
}

function aggregateScores(scores) {
  const playerMap = new Map();

  for (const s of scores) {
    const uid = s.uid || s.playerName || 'anon';
    if (!playerMap.has(uid)) {
      playerMap.set(uid, {
        uid,
        playerName: s.playerName || 'İsimsiz Oyuncu',
        photoURL: s.photoURL || '',
        games: 0,
        totalGuesses: 0,
        totalTime: 0,
        totalPoints: 0,
        wins: 0,
      });
    }
    const p = playerMap.get(uid);
    p.games++;
    p.totalPoints += (s.points || calculateGameScore(s.won, s.guesses, s.time));

    if (s.won) {
      p.wins++;
      if (s.guesses > 0) p.totalGuesses += s.guesses;
      p.totalTime += s.time;
    }
    if (s.playerName) p.playerName = s.playerName;
    if (s.photoURL && !p.photoURL) p.photoURL = s.photoURL;
  }

  const result = [];
  for (const p of playerMap.values()) {
    const countForGuess = p.wins > 0 ? p.wins : (p.games > 0 ? p.games : 1);
    const avgGuesses = p.totalGuesses > 0 ? (p.totalGuesses / countForGuess) : 0;

    const countForTime = p.wins > 0 ? p.wins : (p.games > 0 ? p.games : 1);
    const avgTime = p.totalTime > 0 ? (p.totalTime / countForTime) : 0;
    const winRate = p.games > 0 ? Math.round((p.wins / p.games) * 100) : 0;

    result.push({
      uid: p.uid,
      playerName: p.playerName,
      photoURL: p.photoURL || '',
      totalPoints: p.totalPoints,
      avgPoints: Math.round(p.totalPoints / (p.games || 1)),
      guesses: Math.round(avgGuesses * 10) / 10,
      time: Math.round(avgTime * 10) / 10,
      won: p.wins > 0,
      games: p.games,
      wins: p.wins,
      winRate,
    });
  }

  // Lig Sıralaması: En yüksek toplam lig puanı -> Kazanma oranı -> Ortalama deneme -> Ortalama süre
  result.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (a.guesses > 0 && b.guesses > 0 && a.guesses !== b.guesses) return a.guesses - b.guesses;
    return a.time - b.time;
  });

  return result;
}

// Render modern analytical leaderboard
export function renderLeaderboard(scores, period) {
  const container = document.getElementById('leaderboard-content');
  if (!container) return;

  if (scores.length === 0) {
    container.innerHTML = '<div class="leaderboard-empty">Henüz bu dönemde oynayan olmamış 🎮<br><span style="font-size:0.8rem;opacity:0.7">İlk skoru siz kaydedin!</span></div>';
    return;
  }

  const uid = getUid();
  const isDaily = period === 'daily';

  // Bilgi rozeti (Puanlama Kuralı)
  const ruleText = isDaily
    ? '⚡ <strong>Puan:</strong> Tahmin Başarısı (Maks 600) + Hız Bonusu (Maks 400)'
    : '🏆 <strong>Lig:</strong> Toplam Lig Puanı & Galibiyet Yüzdesi esas alınır';

  let html = `<div class="leaderboard-rule-badge">${ruleText}</div>`;

  // --- PODYUM (En az 2 veya 3 oyuncu varsa göster) ---
  if (scores.length >= 2) {
    const p1 = scores[0];
    const p2 = scores[1];
    const p3 = scores[2] || null;

    html += `<div class="podium-container">
      <div class="podium-card second">
        <div class="podium-medal">🥈</div>
        <div class="podium-name">${p2.photoURL ? `<img class="badge-avatar-img" src="${p2.photoURL}" alt="" onerror="this.style.display='none'"> ` : ''}${escapeHtml(p2.playerName)}</div>
        <div class="podium-points">${isDaily ? p2.points : p2.totalPoints} <span style="font-size:0.65rem">P</span></div>
        <div class="podium-sub">${isDaily ? `${p2.guesses} Deneme • ${formatLeaderboardTime(p2.time)}` : `%${p2.winRate} Galibiyet`}</div>
      </div>
      <div class="podium-card first">
        <div class="podium-medal">👑 🥇</div>
        <div class="podium-name">${p1.photoURL ? `<img class="badge-avatar-img" src="${p1.photoURL}" alt="" onerror="this.style.display='none'"> ` : ''}${escapeHtml(p1.playerName)}</div>
        <div class="podium-points">${isDaily ? p1.points : p1.totalPoints} <span style="font-size:0.65rem">P</span></div>
        <div class="podium-sub">${isDaily ? `${p1.guesses} Deneme • ${formatLeaderboardTime(p1.time)}` : `%${p1.winRate} Galibiyet`}</div>
      </div>
      ${p3 ? `
      <div class="podium-card third">
        <div class="podium-medal">🥉</div>
        <div class="podium-name">${p3.photoURL ? `<img class="badge-avatar-img" src="${p3.photoURL}" alt="" onerror="this.style.display='none'"> ` : ''}${escapeHtml(p3.playerName)}</div>
        <div class="podium-points">${isDaily ? p3.points : p3.totalPoints} <span style="font-size:0.65rem">P</span></div>
        <div class="podium-sub">${isDaily ? `${p3.guesses} Deneme • ${formatLeaderboardTime(p3.time)}` : `%${p3.winRate} Galibiyet`}</div>
      </div>` : ''}
    </div>`;
  }

  // --- ANALİTİK KART LİSTESİ ---
  scores.forEach((s, i) => {
    const isCurrent = Boolean(uid && s.uid === uid);
    const rowClass = isCurrent ? ' lb-card is-current' : ' lb-card';
    const rankIcons = ['🥇', '🥈', '🥉'];
    const rankDisplay = i < 3 ? rankIcons[i] : `#${i + 1}`;

    const scoreDisplay = isDaily ? (s.points || 0) : (s.totalPoints || 0);
    const timeDisplay = formatLeaderboardTime(s.time);
    const guessDisplay = isDaily ? `${s.guesses} Deneme` : `Ort. ${s.guesses.toFixed(1)} Deneme`;

    html += `
      <div class="${rowClass}">
        <div class="lb-left">
          <div class="lb-rank">${rankDisplay}</div>
          <div class="lb-info">
            <div class="lb-name-row">
              ${s.photoURL ? `<img class="badge-avatar-img" src="${s.photoURL}" alt="" onerror="this.style.display='none'"> ` : ''}
              <span class="lb-name">${escapeHtml(s.playerName || 'İsimsiz')}</span>
              ${isCurrent ? '<span class="lb-you-tag">SİZ</span>' : ''}
            </div>
            <div class="lb-tags">
              <span class="lb-tag">🎯 ${s.won ? guessDisplay : 'Bilemedi ❌'}</span>
              <span class="lb-tag">⏱️ ${s.won ? timeDisplay : '-'}</span>
              ${!isDaily ? `<span class="lb-tag">🎮 ${s.games} Oyun (%${s.winRate})</span>` : ''}
            </div>
          </div>
        </div>
        <div class="lb-right">
          <div class="lb-score">${scoreDisplay}</div>
          <div class="lb-score-label">${isDaily ? 'GÜN PUANI' : 'LİG PUANI'}</div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function formatLeaderboardTime(seconds) {
  const sec = Number(seconds) || 0;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Setup leaderboard tab switching
export function setupLeaderboardTabs(onTabChange) {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      onTabChange(tab.getAttribute('data-period'));
    });
  });
}
