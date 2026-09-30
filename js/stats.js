// Çelimeluk - Modern & Authoritative Statistics (Cloud Synced & Local Safe)
import { getLocalDateString, getDaysBetweenDates } from './date-utils.js';
import { getDb, ensureFirebaseReady, getCurrentUser, getUid } from './firebase-config.js';

export function getStatsKey(user = getCurrentUser()) {
  const uid = user ? user.uid : getUid();
  return uid ? `celimeluk_stats_${uid}` : 'celimeluk_stats_guest';
}

export function getDefaultStats() {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    failedGames: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    totalTime: 0,
    bestTime: null,
    totalPoints: 0,
    avgPoints: 0,
    avgGuesses: 0,
    lastPlayedDate: null,
    history: [], // [{ date: 'YYYY-MM-DD', won: true, guesses: 4, time: 35.2, points: 740 }]
    syncedWithCloud: false,
    lastSyncTimestamp: null,
  };
}

/**
 * Validates, cleans, and computes derived fields from raw stats.
 * Critically handles active streak expiry if the user missed days.
 */
export function getEffectiveStats(rawStats) {
  const s = { ...getDefaultStats(), ...(rawStats || {}) };
  const today = getLocalDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  // GÜVENİLİR SERİ KONTROLÜ:
  // Son oynanan oyun dünden eskiyse, kesintisiz seri doğal olarak bozulmuştur (0 olur).
  // Eğer son oyun dün veya bugün ise seri aktiftir.
  if (s.lastPlayedDate !== today && s.lastPlayedDate !== yesterdayStr) {
    s.currentStreak = 0;
  }

  // Dağılım ve oyun sayıları tutarlılığı
  const dist = s.guessDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const distWins = Object.values(dist).reduce((a, b) => a + (Number(b) || 0), 0);
  
  // gamesWon en az dağılımdaki galibiyetler kadar olmalı
  s.gamesWon = Math.max(Number(s.gamesWon) || 0, distWins);
  s.failedGames = Number(s.failedGames) || Math.max(0, (s.gamesPlayed || 0) - s.gamesWon);

  if (s.gamesPlayed < s.gamesWon + s.failedGames) {
    s.gamesPlayed = s.gamesWon + s.failedGames;
  }

  s.winRate = s.gamesPlayed > 0 ? Math.round((s.gamesWon / s.gamesPlayed) * 100) : 0;

  // Ortalama deneme sayısı (yalnızca kazanılan oyunlar)
  let totalGuessWeight = 0;
  for (let g = 1; g <= 6; g++) {
    totalGuessWeight += g * (dist[g] || 0);
  }
  s.avgGuesses = s.gamesWon > 0 && distWins > 0
    ? (totalGuessWeight / distWins)
    : 0;

  // Ortalama süre ve lig puanı
  s.avgTime = s.gamesWon > 0 ? (s.totalTime / s.gamesWon) : 0;
  s.avgPoints = s.gamesPlayed > 0 ? Math.round((s.totalPoints || 0) / s.gamesPlayed) : 0;

  return s;
}

export function getStats(user = getCurrentUser()) {
  try {
    const key = getStatsKey(user);
    let stored = localStorage.getItem(key);
    // Legacy migration: If guest and legacy celimeluk_stats exists, migrate it
    if (!stored && !user && localStorage.getItem('celimeluk_stats')) {
      stored = localStorage.getItem('celimeluk_stats');
      localStorage.setItem('celimeluk_stats_guest', stored);
      localStorage.removeItem('celimeluk_stats');
    }
    if (stored) {
      const parsed = JSON.parse(stored);
      return getEffectiveStats(parsed);
    }
  } catch (e) {
    console.error('Stats yükleme hatası:', e);
  }
  return getEffectiveStats(getDefaultStats());
}

export function saveStats(stats, user = getCurrentUser()) {
  try {
    const key = getStatsKey(user);
    localStorage.setItem(key, JSON.stringify(stats));
  } catch (e) {
    console.error('Stats kaydetme hatası:', e);
  }
}

/**
 * Updates stats when a game concludes.
 * Prevents double-counting if triggered multiple times on the same date.
 */
export function updateStats(won, guessCount, elapsedSeconds, points = 0, user = getCurrentUser()) {
  const stats = getStats(user);
  const today = getLocalDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  const cleanGuesses = Number(guessCount) || (won ? 1 : 6);
  const cleanTime = Number(elapsedSeconds) || 0;
  const cleanPoints = Number(points) || 0;

  // Güvenlik ve Tutarlılık: Bugün zaten kaydedildiyse mükerrer artış yapılmaz
  const alreadyRecordedToday = (stats.lastPlayedDate === today);

  if (!alreadyRecordedToday) {
    stats.gamesPlayed++;

    if (won) {
      stats.gamesWon++;
      stats.guessDistribution[cleanGuesses] = (stats.guessDistribution[cleanGuesses] || 0) + 1;
      stats.totalTime += cleanTime;
      stats.totalPoints = (stats.totalPoints || 0) + cleanPoints;

      if (stats.bestTime === null || cleanTime < stats.bestTime) {
        stats.bestTime = cleanTime;
      }

      // Seri artışı
      if (stats.lastPlayedDate === yesterdayStr || !stats.lastPlayedDate) {
        stats.currentStreak = (stats.currentStreak || 0) + 1;
      } else {
        stats.currentStreak = 1;
      }
      stats.maxStreak = Math.max(stats.maxStreak || 0, stats.currentStreak);
    } else {
      stats.failedGames = (stats.failedGames || 0) + 1;
      stats.currentStreak = 0;
    }

    stats.lastPlayedDate = today;

    // Geçmiş listesini güncelle (son 30 oyun saklanır)
    if (!Array.isArray(stats.history)) stats.history = [];
    stats.history = stats.history.filter(h => h.date !== today);
    stats.history.push({
      date: today,
      won: Boolean(won),
      guesses: won ? cleanGuesses : 'X',
      time: cleanTime,
      points: cleanPoints
    });

    if (stats.history.length > 30) {
      stats.history = stats.history.slice(-30);
    }

    saveStats(stats, user);
  }

  return getEffectiveStats(stats);
}

/**
 * Cloud Synchronization:
 * Rebuilds the authoritative, uncorrupted game statistics directly
 * from Firestore `scores` collection for this specific Google user.
 */
export async function syncUserStatsFromCloud(user) {
  if (!user || !user.uid) return getStats();

  const ready = await ensureFirebaseReady();
  if (!ready) return getStats();

  try {
    const fs = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
    const db = getDb();
    if (!db) return getStats();

    // 1. Kullanıcının Firestore'daki tüm günlük skorlarını çek
    const q = fs.query(
      fs.collection(db, 'scores'),
      fs.where('uid', '==', user.uid)
    );
    const snap = await fs.getDocs(q);

    // 2. Varsa oyuncu profilini de çek (tarihsel maxStreak'i korumak için)
    let playerDoc = null;
    try {
      const pRef = fs.doc(db, 'players', user.uid);
      const pSnap = await fs.getDoc(pRef);
      if (pSnap.exists()) playerDoc = pSnap.data();
    } catch (e) {
      // non-fatal
    }

    if (snap.empty && !playerDoc) {
      const emptyStats = getDefaultStats();
      saveStats(emptyStats, user);
      return getEffectiveStats(emptyStats);
    }

    // Skorları tarihe göre tekilleştir (mükerrer varsa kazananı veya yüksek puanlıyı al)
    const dateMap = new Map();
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (!data || !data.date) return;
      const existing = dateMap.get(data.date);
      if (!existing) {
        dateMap.set(data.date, data);
      } else {
        if (!existing.won && data.won) {
          dateMap.set(data.date, data);
        } else if (existing.won === data.won && (data.points || 0) > (existing.points || 0)) {
          dateMap.set(data.date, data);
        }
      }
    });

    const sortedScores = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Sıralı geçmişten kesin analitiği oluştur
    const gamesPlayed = sortedScores.length;
    let gamesWon = 0;
    let failedGames = 0;
    let totalPoints = 0;
    let totalTime = 0;
    let bestTime = null;
    const guessDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const history = [];

    let runningStreak = 0;
    let maxStreak = playerDoc?.maxStreak || 0;
    let prevDate = null;

    for (const s of sortedScores) {
      const isWon = Boolean(s.won);
      const g = Number(s.guesses) || (isWon ? 1 : 6);
      const t = Number(s.time) || 0;
      const pts = Number(s.points) || 0;

      if (isWon) {
        gamesWon++;
        if (g >= 1 && g <= 6) {
          guessDistribution[g] = (guessDistribution[g] || 0) + 1;
        }
        totalTime += t;
        totalPoints += pts;
        if (bestTime === null || t < bestTime) {
          bestTime = t;
        }

        if (prevDate && getDaysBetweenDates(prevDate, s.date) === 1) {
          runningStreak++;
        } else {
          runningStreak = 1;
        }
        if (runningStreak > maxStreak) maxStreak = runningStreak;
      } else {
        failedGames++;
        runningStreak = 0;
      }

      history.push({
        date: s.date,
        won: isWon,
        guesses: isWon ? g : 'X',
        time: t,
        points: pts
      });

      prevDate = s.date;
    }

    const today = getLocalDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    let currentStreak = 0;
    const lastEntry = sortedScores[sortedScores.length - 1];
    if (lastEntry && lastEntry.won) {
      if (lastEntry.date === today || lastEntry.date === yesterdayStr) {
        currentStreak = runningStreak;
      }
    }

    const lastPlayedDate = lastEntry ? lastEntry.date : null;

    const cloudStats = {
      gamesPlayed,
      gamesWon,
      failedGames,
      currentStreak,
      maxStreak,
      guessDistribution,
      totalTime,
      bestTime,
      totalPoints,
      lastPlayedDate,
      history: history.slice(-30),
      syncedWithCloud: true,
      lastSyncTimestamp: Date.now()
    };

    saveStats(cloudStats, user);
    console.log('İstatistikler buluttan senkronize edildi:', cloudStats);
    return getEffectiveStats(cloudStats);
  } catch (err) {
    console.error('Bulut istatistik senkronizasyon hatası:', err);
    return getStats(user);
  }
}

/**
 * Returns player title & prestige tier based on game history.
 */
export function getPlayerTitle(stats) {
  const games = stats.gamesPlayed || 0;
  const wins = stats.gamesWon || 0;
  const winRate = games > 0 ? (wins / games) * 100 : 0;
  const maxStreak = stats.maxStreak || 0;

  if (games >= 20 && winRate >= 85 && maxStreak >= 7) {
    return { title: 'Kelime Efsanesi', icon: '👑', color: '#f59e0b', desc: 'Seçkin Şampiyon' };
  }
  if (games >= 10 && winRate >= 80) {
    return { title: 'Kelime Ustası', icon: '🧠', color: '#8b5cf6', desc: 'Yüksek İsabet' };
  }
  if (games >= 5 && winRate >= 65) {
    return { title: 'Keskin Tahminci', icon: '🎯', color: '#10b981', desc: 'İstikrarlı Form' };
  }
  if (games >= 3) {
    return { title: 'Kelime Avcısı', icon: '🔍', color: '#3b82f6', desc: 'Deneyimli' };
  }
  if (games >= 1) {
    return { title: 'Çırak Bulmacacı', icon: '🌱', color: '#64748b', desc: 'Yolun Başında' };
  }
  return { title: 'Yeni Oyuncu', icon: '🎮', color: '#94a3b8', desc: 'İlk Oyunu Bekliyor' };
}

/**
 * Generates the recent 7 calendar days form stream (ending with today).
 */
export function getRecentDaysForm(history = [], todayStr = getLocalDateString()) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const baseDate = new Date(y, m - 1, d);

  const histMap = new Map();
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h.date) histMap.set(h.date, h);
    }
  }

  const daysTr = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const monthsTr = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

  const items = [];
  // Geriye doğru 7 gün: today - 6 to today
  for (let i = 6; i >= 0; i--) {
    const target = new Date(baseDate);
    target.setDate(target.getDate() - i);
    const dateStr = getLocalDateString(target);
    const dayName = daysTr[target.getDay()];
    const dayNum = target.getDate();
    const monthName = monthsTr[target.getMonth()];
    const isToday = (i === 0);

    const match = histMap.get(dateStr);
    let state = 'unplayed'; // 'won', 'lost', 'unplayed', 'today_pending'
    let text = 'Oynanmadı';
    let icon = '—';

    if (match) {
      if (match.won) {
        state = 'won';
        text = `${match.guesses}. denemede bulundu${match.points ? ` • ${match.points}P` : ''}`;
        icon = String(match.guesses);
      } else {
        state = 'lost';
        text = 'Kelime bilinemedi ❌';
        icon = '✕';
      }
    } else if (isToday) {
      state = 'today_pending';
      text = 'Bugün henüz oynanmadı';
      icon = '⏳';
    }

    items.push({
      dateStr,
      displayDate: `${dayNum} ${monthName}`,
      dayName,
      dayNum,
      isToday,
      state,
      text,
      icon,
      match
    });
  }

  return items;
}

export function formatStatsTime(seconds) {
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

/**
 * Modern, responsive & analytical statistics renderer
 */
export function renderStats(container, rawStats, options = {}) {
  if (!container) return;

  const stats = getEffectiveStats(rawStats);
  const lastGuessCount = options.lastGuessCount || null;
  const user = options.currentUser || null;
  const isCloudSynced = Boolean(stats.syncedWithCloud && user);

  const playerTitle = getPlayerTitle(stats);
  const recentDays = getRecentDaysForm(stats.history || []);

  const playerName = user?.displayName || localStorage.getItem('celimeluk_player_name') || 'Misafir Oyuncu';
  const photoURL = user?.photoURL || '';

  // Avatar markup
  const avatarHtml = photoURL
    ? `<img class="stats-avatar-img" src="${photoURL}" alt="" onerror="this.outerHTML='<span class=\\'stats-avatar-emoji\\'>👤</span>'">`
    : `<span class="stats-avatar-emoji">👤</span>`;

  // Sync status badge markup
  const syncBadgeHtml = isCloudSynced
    ? `
      <div class="stats-sync-badge cloud" title="Skorlarınız Google hesabınızla tüm cihazlarınızda eşitlendi">
        <span class="sync-dot"></span>
        <span>Bulut Senkron</span>
        <button id="btn-stats-refresh" class="stats-refresh-btn" title="Verileri Güncelle" aria-label="Yenile">🔄</button>
      </div>
    `
    : `
      <button id="btn-stats-login" class="stats-sync-badge guest" title="Skorlarınızı korumak için Google ile giriş yapın">
        <span>🔑 Google ile Eşitle</span>
      </button>
    `;

  // Guess distribution chart calculation
  const maxDist = Math.max(1, ...Object.values(stats.guessDistribution || {}));

  let distributionRows = '';
  for (let i = 1; i <= 6; i++) {
    const count = (stats.guessDistribution && stats.guessDistribution[i]) || 0;
    const pctOfWins = stats.gamesWon > 0 ? Math.round((count / stats.gamesWon) * 100) : 0;
    const barWidth = Math.max(9, Math.round((count / maxDist) * 100));
    const isHighlight = lastGuessCount === i;

    distributionRows += `
      <div class="dist-row">
        <div class="dist-label">${i}</div>
        <div class="dist-bar-wrapper">
          <div class="dist-bar ${isHighlight ? 'highlight' : ''}" style="width: ${barWidth}%">
            <span class="dist-bar-num">${count}</span>
            <span class="dist-bar-pct">%${pctOfWins}</span>
          </div>
        </div>
        ${isHighlight ? `<span class="dist-highlight-tag">⭐ Son Oyun</span>` : ''}
      </div>
    `;
  }

  // 7-day form strip markup
  let formDaysHtml = '';
  for (const day of recentDays) {
    const todayClass = day.isToday ? ' is-today' : '';
    formDaysHtml += `
      <div class="stats-form-day state-${day.state}${todayClass}" title="${day.displayDate} (${day.dayName}): ${day.text}">
        <div class="stats-form-name">${day.dayName}</div>
        <div class="stats-form-date">${day.dayNum}</div>
        <div class="stats-form-icon state-${day.state}">
          ${day.icon}
        </div>
      </div>
    `;
  }

  // Failed games summary
  const failedGamesHtml = (stats.failedGames && stats.failedGames > 0)
    ? `
      <div class="dist-failed-row">
        <span>❌ Çözülemeyen Oyunlar:</span>
        <strong>${stats.failedGames} Oyun (%${100 - stats.winRate})</strong>
      </div>
    `
    : '';

  // Guest callout banner in footer
  const guestBannerHtml = !user
    ? `
      <div class="stats-guest-callout">
        <p>💡 Skorlarınızı kaybetmemek ve şampiyonlar liginde yarışmak için <strong>Google hesabınızla bağlanın</strong>.</p>
        <button id="btn-stats-footer-login" class="btn btn-primary" style="margin-top:8px; width:100%; font-size:0.85rem; padding:8px 12px;">
          Google ile Giriş Yap & Senkronize Et
        </button>
      </div>
    `
    : '';

  const html = `
    <div class="stats-wrapper">
      <!-- 1. Oyuncu Profili & Senkronizasyon -->
      <div class="stats-profile-bar">
        <div class="stats-profile-left">
          <div class="stats-avatar-wrap">${avatarHtml}</div>
          <div class="stats-user-meta">
            <div class="stats-user-name">${escapeHtml(playerName)}</div>
            <div class="stats-user-title" style="color: ${playerTitle.color}">
              <span>${playerTitle.icon}</span> ${playerTitle.title}
            </div>
          </div>
        </div>
        <div class="stats-profile-right">
          ${syncBadgeHtml}
        </div>
      </div>

      <!-- 2. Temel Performans Kartları (4'lü Grid) -->
      <div class="stats-cards-grid">
        <div class="stats-card">
          <div class="stats-card-val">${stats.gamesPlayed}</div>
          <div class="stats-card-lbl">Toplam Oyun</div>
          <div class="stats-card-sub">${stats.gamesWon}G • ${stats.failedGames || 0}K</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-val">%${stats.winRate}</div>
          <div class="stats-card-lbl">Kazanma Oranı</div>
          <div class="stats-card-sub">${stats.winRate >= 80 ? '🔥 Üstün Form' : '🎯 Başarı Oranı'}</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-val ${stats.currentStreak > 0 ? 'streak-fire' : ''}">
            ${stats.currentStreak}${stats.currentStreak > 0 ? ' 🔥' : ''}
          </div>
          <div class="stats-card-lbl">Mevcut Seri</div>
          <div class="stats-card-sub">${stats.currentStreak > 0 ? 'Aktif Günlük Seri' : 'Bugün Kazan & Başlat!'}</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-val">${stats.maxStreak} 🏆</div>
          <div class="stats-card-lbl">En İyi Seri</div>
          <div class="stats-card-sub">Tüm Zamanlar</div>
        </div>
      </div>

      <!-- 3. Analitik Derinlik Göstergeleri (3'lü Kart) -->
      <div class="stats-subgrid">
        <div class="stats-subcard">
          <div class="stats-sub-icon">⚡</div>
          <div class="stats-sub-data">
            <div class="stats-sub-val">${(stats.totalPoints || 0).toLocaleString('tr-TR')} <span class="stats-unit">P</span></div>
            <div class="stats-sub-lbl">Toplam Lig Puanı (Ort. ${stats.avgPoints} P)</div>
          </div>
        </div>
        <div class="stats-subcard">
          <div class="stats-sub-icon">🎯</div>
          <div class="stats-sub-data">
            <div class="stats-sub-val">${stats.avgGuesses > 0 ? stats.avgGuesses.toFixed(1) : '-'} <span class="stats-unit">Deneme</span></div>
            <div class="stats-sub-lbl">Ortalama Galibiyet Tahmini</div>
          </div>
        </div>
        <div class="stats-subcard">
          <div class="stats-sub-icon">⏱️</div>
          <div class="stats-sub-data">
            <div class="stats-sub-val">${stats.bestTime !== null ? formatStatsTime(stats.bestTime) : '-'} <span class="stats-unit">Rekor</span></div>
            <div class="stats-sub-lbl">En Hızlı (Ort. ${stats.avgTime > 0 ? formatStatsTime(stats.avgTime) : '-'})</div>
          </div>
        </div>
      </div>

      <!-- 4. Son 7 Gün Form Durumu -->
      <div class="stats-section-box">
        <div class="stats-section-header">
          <span class="stats-section-title">📅 Son 7 Günün Form Durumu</span>
          <span class="stats-section-subtitle">Günlük seri & devamlılık</span>
        </div>
        <div class="stats-form-strip">
          ${formDaysHtml}
        </div>
      </div>

      <!-- 5. Tahmin Dağılımı Grafiği -->
      <div class="stats-section-box">
        <div class="stats-section-header">
          <span class="stats-section-title">📊 Tahmin Dağılımı</span>
          <span class="stats-section-subtitle">Kazanılan denemeler</span>
        </div>
        <div class="guess-distribution-chart">
          ${distributionRows}
        </div>
        ${failedGamesHtml}
      </div>

      <!-- 6. Aksiyonlar -->
      <div class="stats-footer-actions">
        <button id="btn-stats-to-leaderboard" class="btn btn-secondary">
          🏆 Şampiyonlar Tablosu
        </button>
      </div>

      ${guestBannerHtml}
    </div>
  `;

  container.innerHTML = html;

  // Event Listeners inside stats modal
  container.querySelector('#btn-stats-to-leaderboard')?.addEventListener('click', () => {
    const statsModal = document.getElementById('stats-modal');
    if (statsModal) statsModal.close();
    const btnLb = document.getElementById('btn-leaderboard');
    if (btnLb) btnLb.click();
  });

  const triggerLogin = () => {
    const statsModal = document.getElementById('stats-modal');
    if (statsModal) statsModal.close();
    const nameModal = document.getElementById('name-modal');
    if (nameModal && typeof nameModal.showModal === 'function') nameModal.showModal();
  };

  container.querySelector('#btn-stats-login')?.addEventListener('click', triggerLogin);
  container.querySelector('#btn-stats-footer-login')?.addEventListener('click', triggerLogin);

  container.querySelector('#btn-stats-refresh')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spinning');
    if (user) {
      const freshStats = await syncUserStatsFromCloud(user);
      renderStats(container, freshStats, { lastGuessCount, currentUser: user });
    }
  });
}
