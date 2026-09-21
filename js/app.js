// Çelimeluk - Main Application
// Orchestrates all modules: game logic, keyboard, UI, Firebase, leaderboard, stats, share, Google Auth

import { getWordOfDay, isValidWord, getRandomWord } from './words.js';
import { Game } from './game.js';
import { createKeyboard, updateKeyboardColors, setupPhysicalKeyboard } from './keyboard.js';
import {
  createBoard, setTileLetter, clearTileLetter, revealRow, restoreRow,
  shakeRow, bounceRow, showToast, formatTime, showConfetti,
  openModal, closeModal, setupModalCloseButtons, showResultModal
} from './ui.js';
import {
  initFirebase, isFirebaseConfigured, isReady as isFirebaseReady, getUid,
  signInWithGoogle, signOutUser, onAuthChange, isSignedIn, getCurrentUser,
  getDisplayName, getPhotoURL, ensureFirebaseReady
} from './firebase-config.js';
import { submitScore, getLeaderboard, renderLeaderboard, setupLeaderboardTabs, calculateGameScore } from './leaderboard.js';
import { getStats, updateStats, renderStats } from './stats.js';
import { generateShareText, shareResult } from './share.js';

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
  onAuthChange((user) => {
    handleAuthChange(user);
  });

  // Initialize Firebase
  if (isFirebaseConfigured()) {
    initFirebase().catch(err => console.warn('Firebase init failed:', err));
  }

  // Load name from storage
  playerName = localStorage.getItem(NAME_KEY) || '';

  // Check for saved game
  const savedGame = loadGameState();
  if (savedGame && savedGame.targetWord === dayInfo.word) {
    // Restore existing daily game
    game = Game.deserialize(savedGame);
    restoreGameUI();

    if (game.isGameOver) {
      updateKeyboardColors(keyboardEl, game.letterStatuses);
      timerEl.textContent = formatTime(game.getElapsedSeconds());
      setTimeout(() => {
        const score = game.won ? calculateGameScore(true, game.guesses.length, game.getElapsedSeconds()) : null;
        showResultModal(game.won, game.guesses.length, game.getElapsedSeconds(), game.targetWord, score);
      }, 500);
    } else {
      startTimer();
    }
  } else {
    // New daily game
    game = new Game(dayInfo.word);
  }

  updateModeIndicator();

  // Show login/name modal if first time and not signed in
  if (!playerName && !isSignedIn()) {
    setTimeout(() => showNameModal(), 600);
  }

  // If game is already completed and player name exists, ensure score is submitted to Firestore
  if (game.isGameOver && playerName && currentMode === 'daily') {
    submitScoreToFirebase(game.won ? game.guesses.length : 0, game.getElapsedSeconds(), game.won);
  }
}

// --- Auth State Handler ---
function handleAuthChange(user) {
  if (user && !user.isAnonymous) {
    playerName = user.displayName || playerName || 'Oyuncu';
    localStorage.setItem(NAME_KEY, playerName);
  } else {
    playerName = localStorage.getItem(NAME_KEY) || '';
  }
  updateAuthUI(user);
  updatePlayerBadge();
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

  const isGoogleUser = user && !user.isAnonymous;

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
    // Signed out / Guest
    if (headerAuthIcon) {
      headerAuthIcon.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      `;
    }

    if (signedOutView) signedOutView.style.display = 'block';
    if (signedInView) signedInView.style.display = 'none';
    if (modalTitle) modalTitle.textContent = 'Oyuncu Hesabı 👋';
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

function loadDailyGame() {
  dayInfo = getWordOfDay();
  resetBoard();

  const savedGame = loadGameState();
  if (savedGame && savedGame.targetWord === dayInfo.word) {
    game = Game.deserialize(savedGame);
    restoreGameUI();
    if (game.isGameOver) {
      updateKeyboardColors(keyboardEl, game.letterStatuses);
      timerEl.textContent = formatTime(game.getElapsedSeconds());
    } else {
      startTimer();
    }
  } else {
    game = new Game(dayInfo.word);
    timerEl.textContent = '00:00.0';
  }
}

function startPracticeGame() {
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

  showToast(targetWord.toLocaleUpperCase('tr-TR'), 3000);

  if (currentMode === 'daily') {
    const stats = updateStats(false, 0, elapsed);

    setTimeout(() => {
      showResultModal(false, 0, elapsed, targetWord);
      renderStats(document.getElementById('stats-content'), stats);
      updateResultModalForMode();
    }, 2500);

    submitScoreToFirebase(0, elapsed, false);
    saveGameState();
  } else {
    setTimeout(() => {
      showResultModal(false, 0, elapsed, targetWord);
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

  const user = getCurrentUser();
  const photo = getPhotoURL();

  if (!playerName) {
    playerName = user?.displayName || localStorage.getItem(NAME_KEY) || '';
  }
  if (!playerName) {
    console.warn('Oyuncu ismi bulunamadı, isim modalı açılıyor.');
    showNameModal();
    return;
  }

  console.log('Skor gönderiliyor:', { playerName, photo, guessCount, elapsed, won });
  await submitScore({
    playerName,
    photoURL: photo || '',
    date: new Date().toISOString().split('T')[0],
    dayNumber: dayInfo.dayNumber,
    guesses: guessCount,
    time: elapsed,
    won,
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
  for (let r = 0; r < game.guesses.length; r++) {
    restoreRow(boardEl, r, game.guesses[r].letters);
  }
}

// --- Name / Auth Modal ---
function showNameModal() {
  updateAuthUI(getCurrentUser());
  const input = document.getElementById('player-name-input');
  if (input) input.value = playerName || '';
  openModal('name-modal');
  if (!isSignedIn()) {
    setTimeout(() => input?.focus(), 150);
  }
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

  document.getElementById('btn-leaderboard')?.addEventListener('click', openLeaderboardWithData);

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
        showToast(`Hoş geldin, ${playerName}! 👋`);
        updateAuthUI(user);
        updatePlayerBadge();
        closeModal('name-modal');

        // If today's game is completed, submit score with Google identity
        if (game && game.isGameOver && currentMode === 'daily') {
          await submitScoreToFirebase(game.won ? game.guesses.length : 0, game.getElapsedSeconds(), game.won);
        }
      }
    } catch (err) {
      console.warn('Google giriş hatası:', err);
      if (err.code === 'auth/operation-not-allowed') {
        showToast('Firebase Console\'da Google girişi henüz etkinleştirilmemiş!', 5000);
      } else if (err.code === 'auth/popup-blocked') {
        showToast('Açılır pencere engellendi, lütfen izin verin.', 4000);
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        showToast('Giriş tamamlanamadı. Tekrar deneyin.', 3000);
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
    showToast('Çıkış yapıldı.');
    updateAuthUI(null);
    updatePlayerBadge();
  });

  // Continue button in profile view
  document.getElementById('btn-profile-continue')?.addEventListener('click', () => {
    closeModal('name-modal');
  });

  // Guest / Name form submit
  document.getElementById('name-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('player-name-input');
    const name = input?.value.trim();
    if (name) {
      playerName = name;
      localStorage.setItem(NAME_KEY, name);
      updatePlayerBadge();
      closeModal('name-modal');
      showToast(`Hoş geldin, ${name}!`);

      if (game && game.isGameOver && currentMode === 'daily') {
        await submitScoreToFirebase(game.won ? game.guesses.length : 0, game.getElapsedSeconds(), game.won);
        const modal = document.getElementById('leaderboard-modal');
        if (modal && modal.open) {
          const scores = await getLeaderboard('daily');
          renderLeaderboard(scores, 'daily');
        }
      }
    }
  });

  // Share
  document.getElementById('btn-share')?.addEventListener('click', async () => {
    if (!game || !game.isGameOver) return;
    const text = generateShareText(dayInfo.dayNumber, game.guesses, game.won, game.getElapsedSeconds());
    const result = await shareResult(text);
    if (result === 'copied') {
      showToast('Panoya kopyalandı! 📋');
    }
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
}

function updatePlayerBadge() {
  const badgeName = document.getElementById('current-player-name');
  const badgeAvatar = document.getElementById('player-badge-avatar');
  const photo = getPhotoURL();

  if (badgeName) {
    badgeName.textContent = playerName || 'İsimsiz Oyuncu';
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
