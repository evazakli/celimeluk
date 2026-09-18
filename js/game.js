// Çelimeluk - Game Engine (pure logic, no DOM)

export class Game {
  constructor(targetWord) {
    this.targetWord = targetWord.toLocaleLowerCase('tr-TR');
    this.guesses = [];          // Array of { word, letters: [{letter, status}] }
    this.maxGuesses = 6;
    this.won = false;
    this.lost = false;
    this.currentGuess = '';     // Current input buffer
    this.startTime = null;      // Timestamp when first letter was typed
    this.endTime = null;        // Timestamp when game ended
  }

  addLetter(letter) {
    if (this.isGameOver) return false;
    if (this.currentGuess.length >= 5) return false;
    this.currentGuess += letter.toLocaleLowerCase('tr-TR');
    if (!this.startTime) this.startTime = Date.now();
    return true;
  }

  removeLetter() {
    if (this.isGameOver) return false;
    if (this.currentGuess.length === 0) return false;
    this.currentGuess = this.currentGuess.slice(0, -1);
    return true;
  }

  submitGuess(isValidWordFn) {
    if (this.isGameOver) return { valid: false, reason: 'game-over' };
    if (this.currentGuess.length !== 5) return { valid: false, reason: 'not-enough' };
    if (!isValidWordFn(this.currentGuess)) return { valid: false, reason: 'invalid-word' };

    const evaluation = this.evaluate(this.currentGuess);
    const guess = { word: this.currentGuess, letters: evaluation };
    this.guesses.push(guess);

    const isCorrect = evaluation.every(l => l.status === 'correct');
    if (isCorrect) {
      this.won = true;
      this.endTime = Date.now();
    } else if (this.guesses.length >= this.maxGuesses) {
      this.lost = true;
      this.endTime = Date.now();
    }

    this.currentGuess = '';

    return {
      valid: true,
      guess,
      won: this.won,
      lost: this.lost,
      guessNumber: this.guesses.length,
      targetWord: this.lost ? this.targetWord : null,
    };
  }

  // Standard Wordle evaluation with proper duplicate handling
  evaluate(guess) {
    const target = [...this.targetWord];
    const guessArr = [...guess];
    const result = guessArr.map(letter => ({ letter, status: 'absent' }));

    // Pass 1: exact matches (green)
    for (let i = 0; i < 5; i++) {
      if (guessArr[i] === target[i]) {
        result[i].status = 'correct';
        target[i] = null;
        guessArr[i] = null;
      }
    }

    // Pass 2: present but wrong position (yellow)
    for (let i = 0; i < 5; i++) {
      if (guessArr[i] === null) continue;
      const idx = target.indexOf(guessArr[i]);
      if (idx !== -1) {
        result[i].status = 'present';
        target[idx] = null;
      }
    }

    return result;
  }

  getElapsedSeconds() {
    if (!this.startTime) return 0;
    const end = this.endTime || Date.now();
    return (end - this.startTime) / 1000;
  }

  get isGameOver() {
    return this.won || this.lost;
  }

  get currentRow() {
    return this.guesses.length;
  }

  // Aggregate keyboard letter statuses (best status wins)
  get letterStatuses() {
    const statuses = new Map();
    const priority = { correct: 3, present: 2, absent: 1 };

    for (const guess of this.guesses) {
      for (const { letter, status } of guess.letters) {
        const current = statuses.get(letter);
        if (!current || priority[status] > priority[current]) {
          statuses.set(letter, status);
        }
      }
    }
    return statuses;
  }

  // Save game state for localStorage persistence
  serialize() {
    return {
      targetWord: this.targetWord,
      guesses: this.guesses,
      won: this.won,
      lost: this.lost,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }

  // Restore game from saved state
  static deserialize(data) {
    const game = new Game(data.targetWord);
    game.guesses = data.guesses || [];
    game.won = data.won || false;
    game.lost = data.lost || false;
    game.startTime = data.startTime || null;
    game.endTime = data.endTime || null;
    return game;
  }
}
