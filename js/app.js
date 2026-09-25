// Çelimeluk - Main Application
// Orchestrates all modules: game logic, keyboard, UI, Firebase, leaderboard, stats, share, Google Auth

import { getWordOfDay, isValidWord, getRandomWord } from './words.js';
import { Game } from './game.js';
import { createKeyboard, updateKeyboardColors, setupPhysicalKeyboard } from './keyboard.js';
import {
  createBoard, setTileLetter, clearTileLetter, revealRow, restoreRow,
  shakeRow, bounceRow, showToast, formatTime, showConfetti,
  openModal, closeModal, setupModalCloseButtons, showResultModal,
  startNextWordCountdown
} from './ui.js';
import {
  initFirebase, isFirebaseConfigured, isReady as isFirebaseReady, getUid,
  signInWithGoogle, signOutUser, onAuthChange, isSignedIn, getCurrentUser,
  getDisplayName, getPhotoURL, ensureFirebaseReady
} from './firebase-config.js';
import {
  submitScore, getLeaderboard, renderLeaderboard, setupLeaderboardTabs,
  calculateGameScore, fetchUserDailyScore
} from './leaderboard.js';
import { getStats, updateStats, renderStats } from './stats.js';
import { generateShareText, shareResult, shareToWhatsApp } from './share.js';
import { getLocalDateString } from './date-utils.js';

// --- Constants ---
const STORAGE_KEY = 'celimeluk_game';
const NAME_KEY = 'celimeluk_player_name';

// --- State ---
let game = null;
let dayInfo = null;
let playerName = '';
let timerInterval = null;
let currentMode = 'daily'; // 'daily' | 'practice'

// --- DOM References ---
const boardEl = document.getElementById('game-board');
const keyboardEl = document.getElementById('keyboard-container');
const timerEl = document.getElementById('timer');
const modeIndicator = document.getElementById('mode-indicator');

// --- Initialize ---
async function init() {
  dayInfo = getWordOfDay();

  // Setup UI
  createBoard(boardEl);
  createKeyboard(keyboardEl, handleKeyPress);
  setupPhysicalKeyboard(handleKeyPress);
  setupModalCloseButtons();
  setupButtons();
  setupModeToggle();

  // Setup leaderboard tabs
  setupLeaderboardTabs(async (period) => {
    renderLeaderboardLoading();
    const scores = await getLeaderboard(period);
    renderLeaderboard(scores, period);
  });

  // Listen to Firebase Auth state
  onAuthChange(async (user) => {
    await handleAuthChange(user);
  });

  // Initialize Firebase (with safety timeout for offline users)
  if (isFirebaseConfigured()) {
    try {
      await Promise.race([
        initFirebase(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase timeout')), 1800))
      ]);
    } catch (err) {
      console.warn('Firebase init wait:', err.message);
    }
  }

  // Load Google user session
  const currentUser = getCurrentUser();
  if (currentUser) {
    playerName = currentUser.displayName || 'Oyuncu';
    localStorage.setItem(NAME_KEY, playerName);
  } else {
    playerName = '';
    localStorage.removeItem(NAME_KEY);
  }

  // Check for saved local game
  const savedGame = loadGameState();
  const todayStr = getLocalDateString();
  const currentStats = getStats();

  // Self-heal: If local storage has a finished game for today, but currentStats.lastPlayedDate !== todayStr,
  // it was fabricated by the previous bug (no legitimate game was ever finished today).
  const isCorruptedBugGame = savedGame &&
    savedGame.targetWord === dayInfo.word &&
    savedGame.isGameOver &&
    currentStats.lastPlayedDate !== todayStr;

  if (isCorruptedBugGame) {
    console.warn('Bozuk yerel oyun durumu tespit edildi (bugün tamamlanmamış), sıfırlanıyor.');
    localStorage.removeItem(STORAGE_KEY);
    game = new Game(dayInfo.word);
    hideDailyCountdownBanner();
  } else if (savedGame && savedGame.targetWord === dayInfo.word) {
    // Restore existing daily game
    game = Game.deserialize(savedGame);
    restoreGameUI();

    if (game.isGameOver) {
      updateKeyboardColors(keyboardEl, game.letterStatuses);
      showDailyCountdownBanner();
      setTimeout(() => {
        const score = game.won ? calculateGameScore(true, game.guesses.length, game.getElapsedSeconds()) : null;
        showResultModal(game.won, game.guesses.length, game.getElapsedSeconds(), game.targetWord, score);
      }, 500);
    } else {
      hideDailyCountdownBanner();
      startTimer();
    }
  } else {
    // New daily game
    game = new Game(dayInfo.word);
    hideDailyCountdownBanner();
  }

  updateModeIndicator();

  // Çapraz Cihaz Kontrolü: Bu Google hesabıyla başka cihazda bugünkü kelime tamamlanmış mı?
  if (currentMode === 'daily' && isSignedIn()) {
    const synced = await syncWithCloudTodayGame(getCurrentUser(), { showToastOnSync: false });
    if (synced && game && game.isGameOver) {
      setTimeout(() => {
        const score = game.won ? calculateGameScore(true, game.guesses.length, game.getElapsedSeconds()) : null;
        showResultModal(game.won, game.guesses.length, game.getElapsedSeconds(), game.targetWord, score);
      }, 500);
    }
  }

  // Google ile giriş yapılmamışsa giriş modalını göster
  if (!isSignedIn()) {
    setTimeout(() => showNameModal(), 500);
  }
}

// Clean up any previously created corrupted 0-guess scores from Firestore
async function cleanupCorruptedCloudScore(user) {
  if (!user || !user.uid) return;
  try {
    const fs = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
    const { getDb } = await import('./firebase-config.js');
    const db = getDb();
    if (!db) return;

    const today = getLocalDateString();
    const docRef = fs.doc(db, 'scores', `${user.uid}_${today}`);
    const snap = await fs.getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      const rawGuesses = Number(data.guesses) || 0;
      const isCorrupt = rawGuesses < 1 || rawGuesses > 6 || !data.gameState?.guesses?.length;
      if (isCorrupt) {
        console.warn('Sunucudaki geçersiz skor kaydı temizleniyor...', docRef.id);
        await fs.deleteDoc(docRef);

        // Fix player profile
        const playerRef = fs.doc(db, 'players', user.uid);
        const playerSnap = await fs.getDoc(playerRef);
        if (playerSnap.exists()) {
          const p = playerSnap.data();
          const badPoints = Number(data.points) || 0;
          await fs.setDoc(playerRef, {
            ...p,
            totalGames: Math.max(0, (p.totalGames || 1) - 1),
            totalWins: Math.max(0, (p.totalWins || 1) - (data.won ? 1 : 0)),
            totalPoints: Math.max(0, (p.totalPoints || badPoints) - badPoints),
            lastPlayedDate: '2026-09-22'
          });
        }

        // Clean local state as well
        localStorage.removeItem(STORAGE_KEY);
        game = new Game(dayInfo.word);
        resetBoard();
        hideDailyCountdownBanner();
        closeModal('result-modal');
      }
    }
  } catch (err) {
    console.warn('cleanupCorruptedCloudScore hatası:', err);
  }
}

// --- Auth State Handler ---
async function handleAuthChange(user) {
  if (user) {
    playerName = user.displayName || 'Oyuncu';
    localStorage.setItem(NAME_KEY, playerName);
    await cleanupCorruptedCloudScore(user);
  } else {
    playerName = '';
    localStorage.removeItem(NAME_KEY);
  }
  updateAuthUI(user);
  updatePlayerBadge();

  // Oturum durumu değiştiğinde (Google ile giriş yapıldığında) buluttan bugünkü oyunu ara
  if (currentMode === 'daily' && user) {
    await syncWithCloudTodayGame(user, { showToastOnSync: true });
  }
}

function updateAuthUI(user) {
  const headerAuthIcon = document.getElementById('header-auth-icon');
  const signedOutView = document.getElementById('auth-signed-out-view');
  const signedInView = document.getElementById('auth-signed-in-view');
  const modalTitle = document.getElementById('auth-modal-title');
  const profileImg = document.getElementById('user-profile-img');
  const profileName = document.getElementById('user-profile-name');
  const profileEmail = document.getElementById('user-profile-email');
  const changeNameBtn = document.getElementById('btn-change-name');

  const isGoogleUser = Boolean(user);

  if (isGoogleUser) {
    // Update header icon with Google avatar
    if (headerAuthIcon) {
      if (user.photoURL) {
        headerAuthIcon.innerHTML = `<img class="header-avatar" src="${user.photoURL}" alt="Profil">`;
      } else {
        headerAuthIcon.innerHTML = `<span style="font-size:1.1rem">👤</span>`;
      }
    }

    // Modal view
    if (signedOutView) signedOutView.style.display = 'none';
    if (signedInView) signedInView.style.display = 'block';
    if (modalTitle) modalTitle.textContent = 'Profiliniz 👋';
    if (profileImg) {
      profileImg.src = user.photoURL || '';
      profileImg.style.display = user.photoURL ? 'block' : 'none';
    }
    if (profileName) profileName.textContent = user.displayName || 'Oyuncu';
    if (profileEmail) profileEmail.textContent = user.email || '';
    if (changeNameBtn) changeNameBtn.textContent = 'Hesap';
  } else {
    // Signed out
    if (headerAuthIcon) {
      headerAuthIcon.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      `;
    }

    if (signedOutView) signedOutView.style.display = 'block';
    if (signedInView) signedInView.style.display = 'none';
    if (modalTitle) modalTitle.textContent = 'Google ile Giriş Yap 👋';
    if (changeNameBtn) changeNameBtn.textContent = 'Giriş Yap';
  }
}

// --- Mode Toggle ---
function setupModeToggle() {
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.getAttribute('data-mode');
      if (newMode === currentMode) return;

      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      switchMode(newMode);
    });
  });
}

function switchMode(mode) {
  currentMode = mode;
  stopTimer();

  if (mode === 'daily') {
    loadDailyGame();
  } else {
    startPracticeGame();
  }

  updateModeIndicator();
}

async function loadDailyGame() {
  dayInfo = getWordOfDay();
  resetBoard();

  const savedGame = loadGameState();
  const todayStr = getLocalDateString();
  const currentStats = getStats();

  const isCorruptedBugGame = savedGame &&
    savedGame.targetWord === dayInfo.word &&
    savedGame.isGameOver &&
    currentStats.lastPlayedDate !== todayStr;

  if (isCorruptedBugGame) {
    console.warn('Bozuk yerel oyun durumu tespit edildi (bugün tamamlanmamış), sıfırlanıyor.');
    localStorage.removeItem(STORAGE_KEY);
    game = new Game(dayInfo.word);
    hideDailyCountdownBanner();
    timerEl.textContent = '00:00.0';
  } else if (savedGame && savedGame.targetWord === dayInfo.word) {
    game = Game.deserialize(savedGame);
    restoreGameUI();
    if (game.isGameOver) {
      updateKeyboardColors(keyboardEl, game.letterStatuses);
      showDailyCountdownBanner();
    } else {
      hideDailyCountdownBanner();
      startTimer();
    }
  } else {
    game = new Game(dayInfo.word);
    hideDailyCountdownBanner();
    timerEl.textContent = '00:00.0';
  }

  // Çapraz cihaz kontrolü
  if (isSignedIn()) {
    await syncWithCloudTodayGame(getCurrentUser(), { showToastOnSync: false });
  }
}

function startPracticeGame() {
  hideDailyCountdownBanner();
  const word = getRandomWord();
  resetBoard();
  game = new Game(word);
  timerEl.textContent = '00:00.0';
}

function resetBoard() {
  createBoard(boardEl);
  createKeyboard(keyboardEl, handleKeyPress);
  const allKeys = keyboardEl.querySelectorAll('.key');
  allKeys.forEach(k => k.classList.remove('correct', 'present', 'absent'));
}

function updateModeIndicator() {
  if (!modeIndicator) return;

  if (currentMode === 'daily') {
    modeIndicator.textContent = `📅 Günün Kelimesi #${dayInfo.dayNumber}`;
    modeIndicator.className = 'mode-indicator';
  } else {
    modeIndicator.textContent = '🎯 Serbest Alıştırma — Sınırsız Oyna!';
    modeIndicator.className = 'mode-indicator practice';
  }
}

// --- Key Press Handler ---
function handleKeyPress(key) {
  if (!isSignedIn()) {
    showNameModal();
    showToast('Oyunu oynamak için lütfen Google ile giriş yapın! 👤', 3000);
    return;
  }

  if (game.isGameOver) return;

  if (key === 'Enter') {
    submitGuess();
  } else if (key === 'Backspace') {
    removeLetter();
  } else {
    addLetter(key);
  }
}

function addLetter(letter) {
  const col = game.currentGuess.length;
  if (game.addLetter(letter)) {
    setTileLetter(boardEl, game.currentRow, col, letter);
    startTimer();
  }
}

function removeLetter() {
  const col = game.currentGuess.length - 1;
  if (game.removeLetter()) {
    clearTileLetter(boardEl, game.currentRow, col);
  }
}

function submitGuess() {
  const row = game.currentRow;
  const result = game.submitGuess(isValidWord);

  if (!result.valid) {
    if (result.reason === 'not-enough') {
      showToast('Yeterli harf yok!');
      shakeRow(boardEl, row);
    } else if (result.reason === 'invalid-word') {
      showToast('Geçersiz kelime!');
      shakeRow(boardEl, row);
    }
    return;
  }

  // Reveal the row with animation
  revealRow(boardEl, row, result.guess.letters, () => {
    updateKeyboardColors(keyboardEl, game.letterStatuses);

    if (result.won) {
      onGameWon(result.guessNumber);
    } else if (result.lost) {
      onGameLost(result.targetWord);
    }
  });

  // Save state (only for daily)
  if (currentMode === 'daily') {
    saveGameState();
  }
}

// --- Game End ---
function onGameWon(guessCount) {
  stopTimer();
  const elapsed = game.getElapsedSeconds();

  bounceRow(boardEl, game.currentRow - 1);
  setTimeout(() => showConfetti(), 300);

  const score = calculateGameScore(true, guessCount, elapsed);

  if (currentMode === 'daily') {
    showDailyCountdownBanner();
    const stats = updateStats(true, guessCount, elapsed);

    setTimeout(() => {
      showResultModal(true, guessCount, elapsed, game.targetWord, score);
      renderStats(document.getElementById('stats-content'), stats, guessCount);
      updateResultModalForMode();
    }, 1800);

    submitScoreToFirebase(guessCount, elapsed, true);
    saveGameState();
  } else {
    setTimeout(() => {
      showResultModal(true, guessCount, elapsed, game.targetWord, score);
      updateResultModalForMode();
    }, 1800);
  }
}

function onGameLost(targetWord) {
  stopTimer();
  const elapsed = game.getElapsedSeconds();
  const guessCount = (game.guesses && game.guesses.length > 0) ? game.guesses.length : 6;

  showToast(targetWord.toLocaleUpperCase('tr-TR'), 3000);

  if (currentMode === 'daily') {
    showDailyCountdownBanner();
    const stats = updateStats(false, guessCount, elapsed);

    setTimeout(() => {
      showResultModal(false, guessCount, elapsed, targetWord);
      renderStats(document.getElementById('stats-content'), stats);
      updateResultModalForMode();
    }, 2500);

    submitScoreToFirebase(guessCount, elapsed, false);
    saveGameState();
  } else {
    setTimeout(() => {
      showResultModal(false, guessCount, elapsed, targetWord);
      updateResultModalForMode();
    }, 2500);
  }
}

function updateResultModalForMode() {
  const shareBtn = document.getElementById('btn-share');
  const leaderboardBtn = document.getElementById('btn-show-leaderboard');
  const newPracticeBtn = document.getElementById('btn-new-practice');
  const nextWordTimer = document.getElementById('next-word-timer');

  if (currentMode === 'practice') {
    if (shareBtn) shareBtn.style.display = 'none';
    if (leaderboardBtn) leaderboardBtn.style.display = 'none';
    if (newPracticeBtn) newPracticeBtn.style.display = '';
    if (nextWordTimer) nextWordTimer.style.display = 'none';
  } else {
    if (shareBtn) shareBtn.style.display = '';
    if (leaderboardBtn) leaderboardBtn.style.display = '';
    if (newPracticeBtn) newPracticeBtn.style.display = 'none';
    if (nextWordTimer) nextWordTimer.style.display = '';
  }
}

async function submitScoreToFirebase(guessCount, elapsed, won) {
  if (currentMode !== 'daily') return;

  const cleanGuesses = Number(guessCount) || (won ? 0 : 6);
  if (cleanGuesses < 1 || cleanGuesses > 6) {
    console.error('Geçersiz tahmin sayısı ile skor gönderilemez:', cleanGuesses);
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    showNameModal();
    showToast('Skorunuzu kaydetmek için lütfen Google ile giriş yapın!', 4000);
    return;
  }

  const photo = getPhotoURL();
  playerName = user.displayName || 'Google Oyuncusu';

  console.log('Skor gönderiliyor:', { playerName, photo, guessCount, elapsed, won });
  await submitScore({
    playerName,
    photoURL: photo || '',
    date: getLocalDateString(),
    dayNumber: dayInfo.dayNumber,
    guesses: guessCount,
    time: elapsed,
    won,
    gameState: game ? game.serialize() : null
  });
}

// --- Timer ---
function startTimer() {
  if (timerInterval || !game.startTime) return;

  timerInterval = setInterval(() => {
    timerEl.textContent = formatTime(game.getElapsedSeconds());
  }, 100);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (game) {
    timerEl.textContent = formatTime(game.getElapsedSeconds());
  }
}

// --- Daily Countdown Banner Helpers ---
function showDailyCountdownBanner() {
  const banner = document.getElementById('daily-countdown-banner');
  const timer = document.getElementById('timer');
  if (banner) banner.style.display = 'flex';
  if (timer) timer.style.display = 'none';
  startNextWordCountdown();
}

function hideDailyCountdownBanner() {
  const banner = document.getElementById('daily-countdown-banner');
  const timer = document.getElementById('timer');
  if (banner) banner.style.display = 'none';
  if (timer) timer.style.display = 'block';
}

// --- Cross-Device Daily Game Cloud Sync ---
let isSyncingCloud = false;

async function syncWithCloudTodayGame(user, options = { showToastOnSync: false }) {
  if (isSyncingCloud) return false;
  if (currentMode !== 'daily') return false;
  if (!dayInfo) dayInfo = getWordOfDay();

  const today = getLocalDateString();
  const uid = user ? user.uid : getUid();

  if (!uid) return false;

  isSyncingCloud = true;
  try {
    const cloudScore = await fetchUserDailyScore({
      uid,
      date: today,
      dayNumber: dayInfo.dayNumber
    });

    if (!cloudScore) {
      // Self-healing: if Firestore has NO score for today, but local state was corrupted
      // with a fake 1-guess win of today's word without any actual gameplay
      if (game && game.isGameOver && game.targetWord === dayInfo.word &&
          game.guesses?.length === 1 && game.guesses[0]?.word === dayInfo.word &&
          getStats().lastPlayedDate !== today) {
        console.warn('Bozuk yerel oyun durumu tespit edildi (bulutta kayıt yok), temizleniyor.');
        game = new Game(dayInfo.word);
        saveGameState();
        resetBoard();
        hideDailyCountdownBanner();
        closeModal('result-modal');
      }
      return false;
    }

    // Verify this cloud score is truly for today's word and dayNumber
    if (cloudScore.dayNumber !== undefined && Number(cloudScore.dayNumber) !== dayInfo.dayNumber) {
      console.warn('Bulunan bulut skoru gün numarası ile eşleşmiyor, senkronize edilmedi.');
      return false;
    }

    console.log('Buluttan bugünkü oyun bulundu ve senkronize ediliyor:', cloudScore);

    // Reconstruct game
    let restoredGame = null;
    if (cloudScore.gameState && cloudScore.gameState.targetWord === dayInfo.word && Array.isArray(cloudScore.gameState.guesses) && cloudScore.gameState.guesses.length > 0) {
      restoredGame = Game.deserialize(cloudScore.gameState);
    } else if (game && game.targetWord === dayInfo.word && Array.isArray(game.guesses) && game.guesses.length > 0) {
      // PRESERVE local game guesses!
      restoredGame = game;
      restoredGame.won = Boolean(cloudScore.won);
      restoredGame.lost = !cloudScore.won;
    } else {
      // NEVER leak or fabricate the target word into guesses!
      restoredGame = new Game(dayInfo.word);
      restoredGame.won = Boolean(cloudScore.won);
      restoredGame.lost = !cloudScore.won;
      restoredGame.startTime = Date.now() - (cloudScore.time || 60) * 1000;
      restoredGame.endTime = Date.now();
    }

    // Check if local game is already this exact completed game with guesses
    const isLocalAlreadySame = game &&
      game.isGameOver &&
      game.targetWord === restoredGame.targetWord &&
      game.guesses?.length === restoredGame.guesses?.length &&
      game.won === restoredGame.won &&
      (game.guesses?.length || 0) > 0;

    if (isLocalAlreadySame) {
      restoreGameUI();
      updateKeyboardColors(keyboardEl, game.letterStatuses);
      showDailyCountdownBanner();
      return true;
    }

    // Replace local game instance with the cloud game
    game = restoredGame;
    saveGameState();

    // Update local stats once if not already recorded today
    try {
      const stats = getStats();
      if (stats.lastPlayedDate !== today) {
        updateStats(game.won, game.guesses.length, game.getElapsedSeconds());
      }
    } catch (e) {
      console.warn('Yerel istatistik senkronizasyon uyarısı:', e);
    }

    // Update UI
    stopTimer();
    resetBoard();
    restoreGameUI();
    updateKeyboardColors(keyboardEl, game.letterStatuses);
    showDailyCountdownBanner();

    // If cloud was missing gameState, patch it now if we have actual guesses
    if ((!cloudScore.gameState || !cloudScore.gameState.guesses?.length) && game.guesses?.length > 0) {
      patchCloudScoreGameState(uid, today, game.serialize()).catch(() => {});
    }

    if (options.showToastOnSync) {
      showToast('Bugünkü oyununuz diğer cihazınızdan senkronize edildi! 📱💻', 3500);
    }

    return true;
  } catch (err) {
    console.warn('syncWithCloudTodayGame hatası:', err);
    return false;
  } finally {
    isSyncingCloud = false;
  }
}

async function patchCloudScoreGameState(uid, date, gameState) {
  try {
    const fs = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
    const { getDb } = await import('./firebase-config.js');
    const db = getDb();
    if (!db || !uid) return;
    const docRef = fs.doc(db, 'scores', `${uid}_${date}`);
    await fs.updateDoc(docRef, { gameState });
  } catch (e) {
    // ignore
  }
}

// --- Game State Persistence (Daily only) ---
function saveGameState() {
  if (currentMode !== 'daily') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game.serialize()));
  } catch (e) {
    console.error('Oyun durumu kaydedilemedi:', e);
  }
}

function loadGameState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    console.error('Oyun durumu yüklenemedi:', e);
    return null;
  }
}

// Restore the UI from a saved game state
function restoreGameUI() {
  if (!game) return;

  if (game.guesses && game.guesses.length > 0) {
    for (let r = 0; r < game.guesses.length; r++) {
      if (game.guesses[r] && game.guesses[r].letters) {
        restoreRow(boardEl, r, game.guesses[r].letters);
      }
    }
  }
}

// --- Name / Auth Modal ---
function showNameModal() {
  updateAuthUI(getCurrentUser());
  openModal('name-modal');
}

// --- Button Setup ---
function setupButtons() {
  // Help
  document.getElementById('btn-help')?.addEventListener('click', () => {
    openModal('help-modal');
  });

  // Stats
  document.getElementById('btn-stats')?.addEventListener('click', () => {
    const stats = getStats();
    const lastGuess = (game?.won && currentMode === 'daily') ? game.guesses.length : null;
    renderStats(document.getElementById('stats-content'), stats, lastGuess);
    openModal('stats-modal');
  });

  // Leaderboard
  const openLeaderboardWithData = async () => {
    updatePlayerBadge();
    openModal('leaderboard-modal');
    renderLeaderboardLoading();
    const scores = await getLeaderboard('daily');
    renderLeaderboard(scores, 'daily');
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-btn[data-period="daily"]')?.classList.add('active');
  };

  // Leaderboard button in header
  document.getElementById('btn-leaderboard')?.addEventListener('click', openLeaderboardWithData);

  // Logo / Title click -> Fuzûlî Quote Modal
  const logoBtn = document.getElementById('logo-btn');
  if (logoBtn) {
    logoBtn.addEventListener('click', () => {
      openModal('quote-modal');
    });
    logoBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal('quote-modal');
      }
    });
  }

  // Profile / Auth button in header
  document.getElementById('btn-auth')?.addEventListener('click', (e) => {
    e.preventDefault();
    showNameModal();
  });

  // Change name / Account button in leaderboard
  const handleAccountClick = (e) => {
    if (e) e.preventDefault();
    closeModal('leaderboard-modal');
    setTimeout(() => {
      showNameModal();
    }, 120);
  };
  document.getElementById('btn-change-name')?.addEventListener('click', handleAccountClick);
  document.getElementById('player-badge-btn')?.addEventListener('click', handleAccountClick);

  // Google Login Button
  document.getElementById('btn-google-login')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-google-login');
    try {
      if (btn) btn.disabled = true;
      showToast('Google penceresi açılıyor...');
      const user = await signInWithGoogle();
      if (user) {
        playerName = user.displayName || 'Oyuncu';
        localStorage.setItem(NAME_KEY, playerName);
        updateAuthUI(user);
        updatePlayerBadge();
        closeModal('name-modal');

        // Check if this Google account already completed today's game on another device
        const synced = await syncWithCloudTodayGame(user, { showToastOnSync: false });
        if (synced) {
          showToast(`Hoş geldin, ${playerName}! Bugünkü oyununuz senkronize edildi. 👋`, 4000);
          setTimeout(() => {
            const score = game.won ? calculateGameScore(true, game.guesses.length, game.getElapsedSeconds()) : null;
            showResultModal(game.won, game.guesses.length, game.getElapsedSeconds(), game.targetWord, score);
            updateResultModalForMode();
          }, 350);
        } else {
          showToast(`Hoş geldin, ${playerName}! 👋`);
        }
      }
    } catch (err) {
      console.error('Google giriş hatası detayı:', err);
      if (err.code === 'auth/unauthorized-domain') {
        showToast('Yetkisiz alan adı! Firebase Console > Settings > Authorized Domains listesine "evazakli.github.io" eklenmeli.', 7000);
      } else if (err.code === 'auth/operation-not-allowed') {
        showToast('Firebase Console\'da Google girişi henüz etkinleştirilmemiş! Lütfen Console\'dan açın.', 6000);
      } else if (err.code === 'auth/popup-blocked') {
        showToast('Tarayıcınız açılır pencereyi engelledi. Lütfen izin verin.', 4000);
      } else if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        showToast('Giriş penceresi kapatıldı.', 2500);
      } else {
        showToast(`Giriş başarısız (${err.code || 'Hata'}): ${err.message || 'Lütfen tekrar deneyin.'}`, 5000);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Logout Button
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await signOutUser();
    playerName = '';
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(STORAGE_KEY);
    showToast('Çıkış yapıldı.');
    updateAuthUI(null);
    updatePlayerBadge();
    closeModal('name-modal');
    loadDailyGame();
    setTimeout(() => showNameModal(), 350);
  });

  // Continue button in profile view
  document.getElementById('btn-profile-continue')?.addEventListener('click', () => {
    closeModal('name-modal');
  });

  // Share (WhatsApp)
  document.getElementById('btn-share')?.addEventListener('click', async () => {
    if (!game || !game.isGameOver) return;
    const score = game.won ? calculateGameScore(true, game.guesses.length, game.getElapsedSeconds()) : 0;
    const text = generateShareText(dayInfo.dayNumber, game.guesses, game.won, game.getElapsedSeconds(), score);
    await shareToWhatsApp(text);
    showToast('WhatsApp açılıyor... 📱 (Panoya da kopyalandı)', 2500);
  });

  // Show leaderboard from result modal
  document.getElementById('btn-show-leaderboard')?.addEventListener('click', async () => {
    closeModal('result-modal');
    setTimeout(openLeaderboardWithData, 300);
  });

  // New practice game from result modal
  document.getElementById('btn-new-practice')?.addEventListener('click', () => {
    closeModal('result-modal');
    startPracticeGame();
  });

  // Go to practice from countdown banner
  document.getElementById('btn-goto-practice')?.addEventListener('click', () => {
    const practiceBtn = document.querySelector('.mode-btn[data-mode="practice"]');
    practiceBtn?.click();
  });

  // Reopen result modal from countdown banner
  document.getElementById('btn-reopen-result')?.addEventListener('click', () => {
    if (game && game.isGameOver) {
      const score = game.won ? calculateGameScore(true, game.guesses.length, game.getElapsedSeconds()) : null;
      showResultModal(game.won, game.guesses.length, game.getElapsedSeconds(), game.targetWord, score);
      updateResultModalForMode();
    }
  });
}

function updatePlayerBadge() {
  const badgeName = document.getElementById('current-player-name');
  const badgeAvatar = document.getElementById('player-badge-avatar');
  const photo = getPhotoURL();

  if (badgeName) {
    badgeName.textContent = isSignedIn() ? (playerName || 'Google Oyuncusu') : 'Giriş Yapılmadı';
  }

  if (badgeAvatar) {
    if (photo) {
      badgeAvatar.innerHTML = `<img class="badge-avatar-img" src="${photo}" alt="" onerror="this.style.display='none'">`;
    } else {
      badgeAvatar.textContent = '👤';
    }
  }
}

function renderLeaderboardLoading() {
  const container = document.getElementById('leaderboard-content');
  if (container) {
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  }
}

// --- Start ---
init().catch(err => console.error('Başlatma hatası:', err));
