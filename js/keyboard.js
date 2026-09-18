// Çelimeluk - Turkish On-Screen Keyboard

const KEYBOARD_ROWS = [
  ['e', 'r', 't', 'y', 'u', 'ı', 'o', 'p', 'ğ', 'ü'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ş', 'i'],
  ['Enter', 'z', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç', 'Backspace']
];

// Turkish uppercase mapping (i→İ, ı→I)
function turkishUpper(letter) {
  return letter.toLocaleUpperCase('tr-TR');
}

export function createKeyboard(container, onKeyPress) {
  container.innerHTML = '';

  for (const row of KEYBOARD_ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyboard-row';

    for (const key of row) {
      const btn = document.createElement('button');
      btn.className = 'key';
      btn.setAttribute('data-key', key);
      btn.type = 'button';

      if (key === 'Enter') {
        btn.classList.add('wide', 'key-enter');
        btn.textContent = 'GİR';
      } else if (key === 'Backspace') {
        btn.classList.add('wide', 'key-backspace');
        btn.innerHTML = '⌫';
      } else {
        btn.textContent = turkishUpper(key);
      }

      btn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        onKeyPress(key);
      });

      rowEl.appendChild(btn);
    }

    container.appendChild(rowEl);
  }
}

export function updateKeyboardColors(container, letterStatuses) {
  const keys = container.querySelectorAll('.key[data-key]');
  for (const keyEl of keys) {
    const letter = keyEl.getAttribute('data-key');
    if (letter === 'Enter' || letter === 'Backspace') continue;

    const status = letterStatuses.get(letter);
    if (status) {
      keyEl.classList.remove('correct', 'present', 'absent');
      keyEl.classList.add(status);
    }
  }
}

// Valid Turkish alphabet letters
const VALID_LETTERS = new Set([
  'a','b','c','ç','d','e','f','g','ğ','h',
  'ı','i','j','k','l','m','n','o','ö','p',
  'r','s','ş','t','u','ü','v','y','z'
]);

export function setupPhysicalKeyboard(onKeyPress) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.repeat) return;

    // Don't capture if a text input is focused
    if (document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA') return;

    if (e.key === 'Enter') {
      e.preventDefault();
      onKeyPress('Enter');
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      onKeyPress('Backspace');
    } else {
      const lower = e.key.toLocaleLowerCase('tr-TR');
      if (VALID_LETTERS.has(lower)) {
        e.preventDefault();
        onKeyPress(lower);
      }
    }
  });
}
