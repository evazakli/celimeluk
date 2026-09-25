import { formatTime } from './ui.js';

const STATUS_EMOJIS = {
  correct: '🟩',
  present: '🟨',
  absent: '⬜',
};

function calculateScore(won, guessCount, time) {
  if (!won) return 0;
  const guessScores = { 1: 600, 2: 500, 3: 420, 4: 350, 5: 280, 6: 200 };
  const baseGuessScore = guessScores[guessCount] || 200;
  const t = Math.max(1, Number(time) || 60);
  const timeBonus = Math.max(20, Math.round(400 * Math.exp(-t / 75)));
  return baseGuessScore + timeBonus;
}

export function generateShareText(dayNumber, guesses, won, elapsedSeconds, score = null) {
  const guessStr = won ? `${guesses.length}/6` : 'X/6';
  const timeStr = formatTime(elapsedSeconds);
  const siteUrl = 'https://evazakli.github.io/celimeluk/';

  const finalScore = (typeof score === 'number')
    ? score
    : calculateScore(won, guesses.length, elapsedSeconds);

  const scoreBadge = won ? `⚡ ${finalScore} Puan` : `0 Puan`;

  let text = `🎯 Çelimeluk #${dayNumber}\n${guessStr} ⏱️ ${timeStr} • ${scoreBadge}\n\n`;

  for (const guess of guesses) {
    const line = guess.letters.map(l => STATUS_EMOJIS[l.status]).join('');
    text += line + '\n';
  }

  const challenge = won
    ? 'Günün kelimesini sen de bulabilir misin? Meydan okuyorum! 🧠'
    : 'Günün kelimesi beni zorladı, sen bulabilir misin? 🧐';

  text += `\n${challenge}\n👉 Hemen Oyna: ${siteUrl}`;

  return text.trim();
}

export async function shareToWhatsApp(text) {
  // Also copy to clipboard as fallback / convenience
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch (e) {
    // Clipboard write could fail due to focus or permissions, ignore safely
  }

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
  return 'whatsapp';
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

