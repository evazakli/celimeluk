// Çelimeluk - Personal Statistics (localStorage)

const STATS_KEY = 'celimeluk_stats';

function getDefaultStats() {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    totalTime: 0,
    bestTime: null,
    lastPlayedDate: null,
  };
}

export function getStats() {
  try {
    const stored = localStorage.getItem(STATS_KEY);
    if (stored) {
      const stats = JSON.parse(stored);
      // Ensure all fields exist (for backward compatibility)
      return { ...getDefaultStats(), ...stats };
    }
  } catch (e) {
    console.error('Stats yükleme hatası:', e);
  }
  return getDefaultStats();
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error('Stats kaydetme hatası:', e);
  }
}

export function updateStats(won, guessCount, elapsedSeconds) {
  const stats = getStats();
  const today = new Date().toISOString().split('T')[0];

  stats.gamesPlayed++;

  if (won) {
    stats.gamesWon++;
    stats.guessDistribution[guessCount] = (stats.guessDistribution[guessCount] || 0) + 1;
    stats.totalTime += elapsedSeconds;

    if (stats.bestTime === null || elapsedSeconds < stats.bestTime) {
      stats.bestTime = elapsedSeconds;
    }

    // Streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (stats.lastPlayedDate === yesterdayStr || stats.lastPlayedDate === null) {
      stats.currentStreak++;
    } else if (stats.lastPlayedDate !== today) {
      stats.currentStreak = 1;
    }

    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
  } else {
    stats.currentStreak = 0;
  }

  stats.lastPlayedDate = today;
  saveStats(stats);
  return stats;
}

// Render stats into the modal
export function renderStats(container, stats, lastGuessCount = null) {
  if (!container) return;

  const winPct = stats.gamesPlayed > 0
    ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
    : 0;

  const avgTime = stats.gamesWon > 0
    ? formatStatsTime(stats.totalTime / stats.gamesWon)
    : '-';

  const bestTime = stats.bestTime !== null
    ? formatStatsTime(stats.bestTime)
    : '-';

  // Find max distribution value for bar scaling
  const maxDist = Math.max(1, ...Object.values(stats.guessDistribution));

  let html = `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${stats.gamesPlayed}</div>
        <div class="stat-label">Oyun</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${winPct}</div>
        <div class="stat-label">Kazanma %</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.currentStreak}</div>
        <div class="stat-label">Seri</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.maxStreak}</div>
        <div class="stat-label">En Uzun Seri</div>
      </div>
    </div>

    <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr);">
      <div class="stat-item">
        <div class="stat-value" style="font-size:1.1rem">${avgTime}</div>
        <div class="stat-label">Ort. Süre</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="font-size:1.1rem">${bestTime}</div>
        <div class="stat-label">En Hızlı</div>
      </div>
    </div>

    <div class="guess-distribution">
      <h3>Tahmin Dağılımı</h3>
  `;

  for (let i = 1; i <= 6; i++) {
    const count = stats.guessDistribution[i] || 0;
    const pct = Math.max(8, (count / maxDist) * 100);
    const highlight = lastGuessCount === i ? ' highlight' : '';

    html += `
      <div class="dist-row">
        <div class="dist-label">${i}</div>
        <div class="dist-bar${highlight}" style="width: ${pct}%">${count}</div>
      </div>
    `;
  }

  html += '</div>';
  container.innerHTML = html;
}

function formatStatsTime(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
