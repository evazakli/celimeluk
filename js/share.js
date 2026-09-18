// Çelimeluk - Share Module

import { formatTime } from './ui.js';

const STATUS_EMOJIS = {
  correct: '🟩',
  present: '🟨',
  absent: '⬜',
};

export function generateShareText(dayNumber, guesses, won, elapsedSeconds) {
  const guessStr = won ? `${guesses.length}/6` : 'X/6';
  const timeStr = formatTime(elapsedSeconds);

  let text = `🎯 Çelimeluk #${dayNumber}\n${guessStr} ⏱️ ${timeStr}\n\n`;

  for (const guess of guesses) {
    const line = guess.letters.map(l => STATUS_EMOJIS[l.status]).join('');
    text += line + '\n';
  }

  return text.trim();
}

export async function shareResult(text) {
  // Try native Web Share API first (works great on mobile)
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      // Fall through to clipboard
    }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (err) {
    // Last resort: textarea trick
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return 'copied';
  }
}
