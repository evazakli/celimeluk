// Çelimeluk - UI Module (DOM manipulation, animations, toasts)

function turkishUpper(letter) {
  return letter.toLocaleUpperCase('tr-TR');
}

// --- Game Board ---

export function createBoard(container, rows = 6, cols = 5) {
  container.innerHTML = '';
  for (let r = 0; r < rows; r++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    rowEl.setAttribute('data-row', r);
    for (let c = 0; c < cols; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.setAttribute('data-row', r);
      tile.setAttribute('data-col', c);
      rowEl.appendChild(tile);
    }
    container.appendChild(rowEl);
  }
}

export function getTile(container, row, col) {
  return container.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
}

export function setTileLetter(container, row, col, letter) {
  const tile = getTile(container, row, col);
  if (!tile) return;
  tile.textContent = letter ? turkishUpper(letter) : '';
  tile.classList.toggle('filled', !!letter);
}

export function clearTileLetter(container, row, col) {
  const tile = getTile(container, row, col);
  if (!tile) return;
  tile.textContent = '';
  tile.classList.remove('filled');
}

// Reveal a row with sequential flip animation
export function revealRow(container, row, letters, onComplete) {
  const tiles = [];
  for (let c = 0; c < letters.length; c++) {
    tiles.push(getTile(container, row, c));
  }

  tiles.forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.add('flip');

      // Halfway through flip, change color
      setTimeout(() => {
        tile.classList.add('revealed', letters[i].status);
        tile.textContent = turkishUpper(letters[i].letter);
      }, 250);

      // After flip completes
      setTimeout(() => {
        tile.classList.remove('flip');
        if (i === tiles.length - 1 && onComplete) {
          onComplete();
        }
      }, 500);
    }, i * 120);
  });
}

// Restore a revealed row (for game restore from saved state)
export function restoreRow(container, row, letters) {
  for (let c = 0; c < letters.length; c++) {
    const tile = getTile(container, row, c);
    tile.textContent = turkishUpper(letters[c].letter);
    tile.classList.add('filled', 'revealed', letters[c].status);
  }
}

export function shakeRow(container, row) {
  const rowEl = container.querySelector(`.row[data-row="${row}"]`);
  if (!rowEl) return;
  rowEl.classList.remove('shake');
  void rowEl.offsetWidth; // Force reflow
  rowEl.classList.add('shake');
  rowEl.addEventListener('animationend', () => rowEl.classList.remove('shake'), { once: true });
}

export function bounceRow(container, row) {
  const rowEl = container.querySelector(`.row[data-row="${row}"]`);
  if (!rowEl) return;
  const tiles = rowEl.querySelectorAll('.tile');
  tiles.forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.add('bounce');
      tile.addEventListener('animationend', () => tile.classList.remove('bounce'), { once: true });
    }, i * 80);
  });
}

// --- Toasts ---

export function showToast(message, duration = 1500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// --- Timer ---

export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds * 10) % 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

// --- Confetti ---

export function showConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#6BCB77', '#FFD93D', '#9B72CF', '#FF6B6B', '#4ECDC4', '#45B7D1'];
  const particles = [];

  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: Math.random() * 8 + 4,
      h: Math.random() * 5 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 2,
      rot: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      opacity: 1,
    });
  }

  let frame = 0;
  const maxFrames = 180;

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame++;

    for (const p of particles) {
      p.x += p.vx;
      p.vy += 0.05;
      p.y += p.vy;
      p.rot += p.rotSpeed;

      if (frame > maxFrames - 40) {
        p.opacity = Math.max(0, p.opacity - 0.025);
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (frame < maxFrames) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  animate();
}

// --- Modal Helpers ---

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (modal.open) {
    try { modal.close(); } catch (e) {}
  }
  try {
    modal.showModal();
  } catch (err) {
    console.warn('showModal fallback:', err);
    modal.setAttribute('open', '');
  }
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (modal.open) {
    try { modal.close(); } catch (e) {}
  }
  modal.removeAttribute('open');
}

export function setupModalCloseButtons() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) modal.close();
    });
  });

  // Close on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.close();
    });
  });
}

// --- Result Modal Content ---

export function showResultModal(won, guessCount, elapsedSeconds, targetWord, score = null) {
  const titleEl = document.getElementById('result-title');
  const contentEl = document.getElementById('result-content');

  const messages = won
    ? ['Dahiane! 🧠', 'Müthiş! 🎉', 'Harika! ⭐', 'Süper! 💪', 'İyi! 👍', 'Zar Zor! 😅']
    : ['Bir Dahaki Sefere 😔'];

  titleEl.textContent = won ? messages[Math.min(guessCount - 1, 5)] : messages[0];

  const timeStr = formatTime(elapsedSeconds);

  contentEl.innerHTML = `
    <div class="result-summary">
      <div class="result-emoji">${won ? '🎯' : '😞'}</div>
      <div class="result-word">${targetWord.toLocaleUpperCase('tr-TR')}</div>
      <div class="result-detail">
        ${won ? `${guessCount}/6 denemede ⏱️ ${timeStr}` : `Kelimeyi bulamadınız (⏱️ ${timeStr})`}
      </div>
      ${won && score !== null ? `
        <div style="margin-top:10px; display:inline-block; padding:6px 14px; background:rgba(155,114,207,0.12); border:1px solid rgba(155,114,207,0.3); border-radius:20px; font-weight:800; font-size:1.05rem; color:var(--color-accent)">
          ⚡ ${score} Puan Kazandınız!
        </div>
      ` : (!won ? `
        <div style="margin-top:10px; display:inline-block; padding:6px 14px; background:rgba(231,76,60,0.12); border:1px solid rgba(231,76,60,0.3); border-radius:20px; font-weight:800; font-size:0.95rem; color:#e74c3c">
          0 Puan • Sıralamaya Eklendi 🏆
        </div>
      ` : '')}
    </div>
  `;

  openModal('result-modal');
  startNextWordCountdown();
}

let countdownInterval = null;

export function updateNextWordCountdown() {
  const modalEl = document.getElementById('countdown');
  const mainEl = document.getElementById('main-countdown');

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const diff = tomorrow - now;
  if (diff <= 0) {
    if (modalEl) modalEl.textContent = 'Yeni kelime hazır! Sayfayı yenileyin 🔄';
    if (mainEl) mainEl.textContent = 'Yeni kelime hazır! 🔄';
    return;
  }

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const text = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  if (modalEl) modalEl.textContent = text;
  if (mainEl) mainEl.textContent = text;
}

export function startNextWordCountdown() {
  updateNextWordCountdown();
  if (!countdownInterval) {
    countdownInterval = setInterval(updateNextWordCountdown, 1000);
  }
}

