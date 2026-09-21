// Çelimeluk - Main Application
// Orchestrates all modules: game logic, keyboard, UI, Firebase, leaderboard, stats, share

import { getWordOfDay, isValidWord, getRandomWord } from './words.js';
import { Game } from './game.js';
import { createKeyboard, updateKeyboardColors, setupPhysicalKeyboard } from './keyboard.js';
import {
  createBoard, setTileLetter, clearTileLetter, revealRow, restoreRow,
  shakeRow, bounceRow, showToast, formatTime, showConfetti,
  openModal, closeModal, setupModalCloseButtons, showResultModal
} from './ui.js';
import { initFirebase, isFirebaseConfigured, isReady as isFirebaseReady, getUid } from './firebase-config.js';
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

  // Initialize Firebase (non-blocking)
  if (isFirebaseConfigured()) {
    initFirebase().catch(err => console.warn('Firebase init failed:', err));
  }

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

  // Check player name
  playerName = localStorage.getItem(NAME_KEY) || '';
  if (!playerName) {
    showNameModal();
  }

  // If game is already completed and player name exists, ensure score is submitted to Firestore
  if (game.isGameOver && playerName && currentMode === 'daily') {
    submitScoreToFirebase(game.won ? game.guesses.length : 0, game.getElapsedSeconds(), game.won);
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
  // Reset keyboard key colors
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
    // Update keyboard colors after reveal
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

  // Bounce animation
  bounceRow(boardEl, game.currentRow - 1);

  // Confetti
  setTimeout(() => showConfetti(), 300);

  const score = calculateGameScore(true, guessCount, elapsed);

  if (currentMode === 'daily') {
    // Update local stats
    const stats = updateStats(true, guessCount, elapsed);

    // Show result
    setTimeout(() => {
      showResultModal(true, guessCount, elapsed, game.targetWord, score);
      renderStats(document.getElementById('stats-content'), stats, guessCount);
      updateResultModalForMode();
    }, 1800);

    // Submit score to Firebase
    submitScoreToFirebase(guessCount, elapsed, true);

    saveGameState();
  } else {
    // Practice mode — no stats, no Firebase
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
    // Practice mode
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
    // Practice mode: hide share/leaderboard/countdown, show new game button
    if (shareBtn) shareBtn.style.display = 'none';
    if (leaderboardBtn) leaderboardBtn.style.display = 'none';
    if (newPracticeBtn) newPracticeBtn.style.display = '';
    if (nextWordTimer) nextWordTimer.style.display = 'none';
  } else {
    // Daily mode: show share/leaderboard/countdown, hide new game button
    if (shareBtn) shareBtn.style.display = '';
    if (leaderboardBtn) leaderboardBtn.style.display = '';
    if (newPracticeBtn) newPracticeBtn.style.display = 'none';
    if (nextWordTimer) nextWordTimer.style.display = '';
  }
}

async function submitScoreToFirebase(guessCount, elapsed, won) {
  if (currentMode !== 'daily') return; // Never submit practice scores

  if (!playerName) {
    playerName = localStorage.getItem(NAME_KEY) || '';
  }
  if (!playerName) {
    console.warn('Oyuncu ismi bulunamadı, isim modalı açılıyor.');
    showNameModal();
    return;
  }

  console.log('Skor gönderiliyor:', { playerName, guessCount, elapsed, won });
  await submitScore({
    playerName,
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

// --- Name Modal ---
function showNameModal() {
  openModal('name-modal');
  const input = document.getElementById('player-name-input');
  setTimeout(() => input?.focus(), 100);
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
    // Reset active tab
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-btn[data-period="daily"]')?.classList.add('active');
  };

  document.getElementById('btn-leaderboard')?.addEventListener('click', openLeaderboardWithData);

  // Change name button
  const handleChangeName = () => {
    closeModal('leaderboard-modal');
    const input = document.getElementById('player-name-input');
    if (input) input.value = playerName || '';
    openModal('name-modal');
    setTimeout(() => input?.focus(), 100);
  };
  document.getElementById('btn-change-name')?.addEventListener('click', handleChangeName);
  document.getElementById('player-badge-btn')?.addEventListener('click', handleChangeName);

  // Name form
  document.getElementById('name-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('player-name-input');
    const name = input?.value.trim();
    if (name) {
      playerName = name;
      localStorage.setItem(NAME_KEY, name);
      updatePlayerBadge();
      closeModal('name-modal');

      if (game && game.isGameOver && currentMode === 'daily') {
        await submitScoreToFirebase(game.won ? game.guesses.length : 0, game.getElapsedSeconds(), game.won);
        // Refresh leaderboard if open
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
  const badge = document.getElementById('current-player-name');
  if (badge) {
    badge.textContent = playerName || 'İsimsiz Oyuncu';
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
