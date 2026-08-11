const KANJI_REGEX = /[\u4e00-\u9fff]/g;
const HIRAGANA_REGEX = /[\u3040-\u309f]/;

const state = {
  cards: [],
  selectedLevels: new Set(['N5', 'N4', 'N3', 'N2', 'N1']),
  quizItems: [],
  currentIndex: 0,
  answered: false,
  started: false,
  isGenerating: false,
  generationComplete: false,
  generationId: 0,
  totalEligible: 0,
  waitingForNext: false,
  autoAdvanceRemaining: 0
};

let autoAdvanceInterval = null;

const levelLabels = ['N5', 'N4', 'N3', 'N2', 'N1'];

async function init() {
  await loadCards();
  renderLevels();
  bindEvents();
  updateStartHint();
}

async function loadCards() {
  const response = await fetch('/api/cards');
  const data = await response.json();
  state.cards = data.cards;
}

function isQuizEligible(word) {
  const kanjiMatches = word.match(KANJI_REGEX) || [];
  const hasHiragana = HIRAGANA_REGEX.test(word);
  return kanjiMatches.length >= 2 || (kanjiMatches.length === 1 && hasHiragana);
}

function getKanjiIndices(word) {
  const indices = [];
  for (let i = 0; i < word.length; i += 1) {
    if (KANJI_REGEX.test(word[i])) {
      indices.push(i);
    }
  }
  KANJI_REGEX.lastIndex = 0;
  return indices;
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getEligibleCards() {
  const selectedLevels = [...state.selectedLevels];
  return state.cards.filter(
    (card) => selectedLevels.includes(card.level) && isQuizEligible(card.word)
  );
}

function createKanjiServerError(message) {
  const error = new Error(message);
  error.isKanjiServerError = true;
  return error;
}

async function probeKanjiServerViaSimilar() {
  const response = await fetch('/api/similar-kanji', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kanji: '水', count: 1 })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw createKanjiServerError(
      data.message || 'Kanji server không khả dụng. Chạy: python kanji_server.py'
    );
  }
}

async function checkKanjiServer() {
  try {
    const response = await fetch('/api/kanji-health');

    if (response.status === 404) {
      await probeKanjiServerViaSimilar();
      return;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.available) {
      throw createKanjiServerError(
        data.message || 'Kanji server không khả dụng. Chạy: python kanji_server.py'
      );
    }
  } catch (error) {
    if (error.isKanjiServerError) {
      throw error;
    }
    throw createKanjiServerError('Không kết nối được kanji server. Chạy: python kanji_server.py');
  }
}

async function fetchSimilarKanji(kanji, count = 3) {
  try {
    const response = await fetch('/api/similar-kanji', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanji, count })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw createKanjiServerError(
        data.message || 'Kanji server không khả dụng. Chạy: python kanji_server.py'
      );
    }

    return (data.similar || []).map((item) => item.kanji).filter((ch) => ch !== kanji);
  } catch (error) {
    if (error.isKanjiServerError) {
      throw error;
    }
    throw createKanjiServerError('Không kết nối được kanji server. Chạy: python kanji_server.py');
  }
}

async function buildQuizItem(card) {
  const kanjiIndices = getKanjiIndices(card.word);
  if (!kanjiIndices.length) {
    return null;
  }

  const removeIndex = kanjiIndices[Math.floor(Math.random() * kanjiIndices.length)];
  const removedKanji = card.word[removeIndex];
  const displayWord = `${card.word.slice(0, removeIndex)}□${card.word.slice(removeIndex + 1)}`;

  let distractors = [];
  try {
    distractors = await fetchSimilarKanji(removedKanji, 3);
  } catch (error) {
    if (error.isKanjiServerError) {
      throw error;
    }
    return null;
  }

  const uniqueDistractors = [...new Set(distractors.filter((ch) => ch !== removedKanji))];
  const options = shuffleArray([removedKanji, ...uniqueDistractors.slice(0, 3)]);

  if (options.length <= 1) {
    return null;
  }

  return {
    card,
    removeIndex,
    removedKanji,
    displayWord,
    options,
    selectedOption: null
  };
}

async function generateQuizItemsAsync(shuffledCards, sessionId) {
  let firstItemShown = false;

  for (const card of shuffledCards) {
    if (sessionId !== state.generationId) {
      return;
    }

    let item;
    try {
      item = await buildQuizItem(card);
    } catch (error) {
      if (error.isKanjiServerError) {
        handleKanjiServerFailure(sessionId, error.message);
        return;
      }
      continue;
    }

    if (sessionId !== state.generationId) {
      return;
    }

    if (!item) {
      continue;
    }

    state.quizItems.push(item);

    if (!firstItemShown) {
      firstItemShown = true;
      setVisible('quiz-loading', false);
      setVisible('quiz-area', true);
      showCurrentQuiz();
    } else {
      onQuizItemAdded();
    }
  }

  if (sessionId !== state.generationId) {
    return;
  }

  state.isGenerating = false;
  state.generationComplete = true;
  updateGenerationStatus();

  if (!firstItemShown) {
    setVisible('quiz-loading', false);
    setVisible('quiz-area', false);
    setVisible('quiz-start-screen', true);
    state.started = false;
    alert('Không tạo được câu quiz hợp lệ. Có thể không đủ kanji tương tự cho các từ đã chọn.');
    return;
  }

  if (state.waitingForNext) {
    state.waitingForNext = false;
    if (state.currentIndex < state.quizItems.length) {
      showCurrentQuiz();
    } else if (state.quizItems.length) {
      state.currentIndex = state.quizItems.length - 1;
      showCurrentQuiz();
    }
  }
}

function onQuizItemAdded() {
  updateGenerationStatus();
  updateQuizProgress();

  if (state.waitingForNext && state.currentIndex < state.quizItems.length) {
    state.waitingForNext = false;
    showCurrentQuiz();
  }
}

function updateGenerationStatus() {
  const statusEl = document.getElementById('quiz-generation-status');
  if (!statusEl) {
    return;
  }

  if (!state.started) {
    statusEl.classList.add('hidden');
    statusEl.textContent = '';
    return;
  }

  if (state.isGenerating) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = ``;
    return;
  }

  statusEl.classList.add('hidden');
  statusEl.textContent = '';
}

function updateQuizProgress() {
  const quizIndex = document.getElementById('quiz-index');
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');

  const readyCount = Math.max(state.quizItems.length, 1);
  const total = readyCount;

  if (quizIndex) {
    quizIndex.textContent = `${state.currentIndex + 1}/${total}`;
  }

  const progressPercent = Math.round(((state.currentIndex + 1) / total) * 100);
  if (progressText) progressText.textContent = `${progressPercent}%`;
  if (progressBar) progressBar.style.width = `${progressPercent}%`;
}

function renderLevels() {
  const levelList = document.getElementById('level-list');
  if (!levelList) {
    return;
  }

  levelList.innerHTML = '';

  levelLabels.forEach((level) => {
    const button = document.createElement('button');
    button.className = 'level-button';
    button.type = 'button';
    button.dataset.level = level;

    const levelName = document.createElement('span');
    levelName.className = 'level-name';
    levelName.textContent = level;

    const levelCount = document.createElement('span');
    levelCount.className = 'level-count';
    const count = state.cards.filter(
      (card) => card.level === level && isQuizEligible(card.word)
    ).length;
    levelCount.textContent = `${count}`;

    button.appendChild(levelName);
    button.appendChild(levelCount);

    if (state.selectedLevels.has(level)) {
      button.classList.add('active');
    }

    button.addEventListener('click', () => {
      if (state.selectedLevels.has(level)) {
        state.selectedLevels.delete(level);
      } else {
        state.selectedLevels.add(level);
      }

      if (state.started) {
        resetQuiz();
      }

      renderLevels();
      updateStartHint();
    });

    levelList.appendChild(button);
  });
}

function updateStartHint() {
  const hint = document.getElementById('quiz-start-hint');
  if (!hint) {
    return;
  }

  const eligibleCount = getEligibleCards().length;
  if (!state.selectedLevels.size) {
    hint.textContent = 'Hãy chọn ít nhất một cấp độ ở sidebar.';
    return;
  }

  hint.textContent = `Có ${eligibleCount} từ phù hợp cho quiz kanji ở các cấp độ đã chọn.`;
}

function setVisible(id, visible) {
  const element = document.getElementById(id);
  if (element) {
    element.classList.toggle('hidden', !visible);
  }
}

function clearAutoAdvance() {
  if (autoAdvanceInterval) {
    clearInterval(autoAdvanceInterval);
    autoAdvanceInterval = null;
  }
  state.autoAdvanceRemaining = 0;
}

function startAutoAdvance() {
  clearAutoAdvance();
  state.autoAdvanceRemaining = 3;
  updateFeedbackMessage();

  autoAdvanceInterval = setInterval(() => {
    state.autoAdvanceRemaining -= 1;

    if (state.autoAdvanceRemaining <= 0) {
      clearAutoAdvance();
      navigateQuiz(1, true);
      return;
    }

    updateFeedbackMessage();
  }, 1000);
}

function getFeedbackMessage(item) {
  if (!item.selectedOption) {
    return '';
  }

  const baseMessage = item.selectedOption === item.removedKanji
    ? 'Chính xác!'
    : `Sai rồi. Kanji đúng là "${item.removedKanji}".`;

  if (state.autoAdvanceRemaining > 0) {
    return `${baseMessage} Chuyển câu sau ${state.autoAdvanceRemaining}s...`;
  }

  return baseMessage;
}

function updateFeedbackMessage() {
  const item = state.quizItems[state.currentIndex];
  const feedback = document.getElementById('quiz-feedback');
  if (!item || !feedback || !item.selectedOption) {
    return;
  }

  feedback.textContent = getFeedbackMessage(item);
}

function handleKanjiServerFailure(sessionId, message) {
  if (sessionId !== state.generationId) {
    return;
  }

  clearAutoAdvance();
  state.generationId += 1;
  state.quizItems = [];
  state.currentIndex = 0;
  state.answered = false;
  state.started = false;
  state.isGenerating = false;
  state.generationComplete = false;
  state.waitingForNext = false;

  setVisible('quiz-loading', false);
  setVisible('quiz-area', false);
  setVisible('quiz-start-screen', true);
  updateGenerationStatus();
  updateStartHint();

  alert(message);
}

function resetQuiz() {
  clearAutoAdvance();
  state.generationId += 1;
  state.quizItems = [];
  state.currentIndex = 0;
  state.answered = false;
  state.started = false;
  state.isGenerating = false;
  state.generationComplete = false;
  state.totalEligible = 0;
  state.waitingForNext = false;
  setVisible('quiz-area', false);
  setVisible('quiz-loading', false);
  setVisible('quiz-start-screen', true);
  updateGenerationStatus();
  updateStartHint();
}

async function startQuiz() {
  if (!state.selectedLevels.size) {
    alert('Hãy chọn ít nhất một cấp độ.');
    return;
  }

  const shuffledCards = shuffleArray(getEligibleCards());
  if (!shuffledCards.length) {
    alert('Không có từ phù hợp để làm quiz ở các cấp độ đã chọn.');
    return;
  }

  setVisible('quiz-start-screen', false);
  setVisible('quiz-area', false);
  setVisible('quiz-loading', true);

  try {
    await checkKanjiServer();
  } catch (error) {
    setVisible('quiz-loading', false);
    setVisible('quiz-start-screen', true);
    alert(error.message || 'Kanji server không khả dụng.');
    return;
  }

  const sessionId = state.generationId + 1;
  state.generationId = sessionId;
  state.quizItems = [];
  state.currentIndex = 0;
  state.answered = false;
  state.started = true;
  state.isGenerating = true;
  state.generationComplete = false;
  state.totalEligible = shuffledCards.length;
  state.waitingForNext = false;

  updateGenerationStatus();
  generateQuizItemsAsync(shuffledCards, sessionId);
}

function showWaitingState() {
  state.waitingForNext = true;

  setVisible('quiz-waiting', true);
  setVisible('quiz-feedback', false);

  const quizWord = document.getElementById('quiz-word');
  const quizPhonetic = document.getElementById('quiz-phonetic');
  const quizMeaning = document.getElementById('quiz-meaning');
  const quizLevel = document.getElementById('quiz-level');
  const quizIndex = document.getElementById('quiz-index');
  const optionsEl = document.getElementById('quiz-options');
  const questionLabel = document.getElementById('quiz-question-label');

  if (questionLabel) questionLabel.classList.add('hidden');
  if (quizWord) quizWord.textContent = '';
  if (quizPhonetic) quizPhonetic.textContent = '';
  if (quizMeaning) quizMeaning.textContent = '';
  if (quizLevel) quizLevel.textContent = '-';
  if (optionsEl) optionsEl.innerHTML = '';
  if (quizIndex) {
    quizIndex.textContent = `${state.currentIndex + 1}/${state.quizItems.length}+`;
  }

  updateGenerationStatus();
}

function showCurrentQuiz() {
  const item = state.quizItems[state.currentIndex];

  if (!item) {
    clearAutoAdvance();
    showWaitingState();
    return;
  }

  if (!item.selectedOption) {
    clearAutoAdvance();
  }

  state.waitingForNext = false;
  setVisible('quiz-waiting', false);

  state.answered = Boolean(item.selectedOption);

  const quizWord = document.getElementById('quiz-word');
  const quizPhonetic = document.getElementById('quiz-phonetic');
  const quizMeaning = document.getElementById('quiz-meaning');
  const quizLevel = document.getElementById('quiz-level');
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');
  const feedback = document.getElementById('quiz-feedback');
  const optionsEl = document.getElementById('quiz-options');
  const questionLabel = document.getElementById('quiz-question-label');

  if (questionLabel) questionLabel.classList.remove('hidden');
  if (quizWord) quizWord.textContent = item.displayWord;
  if (quizPhonetic) quizPhonetic.textContent = item.card.phonetic;
  if (quizMeaning) quizMeaning.textContent = item.card.mean;
  if (quizLevel) quizLevel.textContent = item.card.level;

  const readyCount = Math.max(state.quizItems.length, 1);
  const quizIndex = document.getElementById('quiz-index');
  if (quizIndex) quizIndex.textContent = `${state.currentIndex + 1}/${readyCount}`;

  const progressPercent = Math.round(((state.currentIndex + 1) / readyCount) * 100);
  if (progressText) progressText.textContent = `${progressPercent}%`;
  if (progressBar) progressBar.style.width = `${progressPercent}%`;

  updateGenerationStatus();

  if (optionsEl) {
    optionsEl.innerHTML = '';
    item.options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiz-option-button';
      button.textContent = option;

      if (item.selectedOption) {
        if (option === item.removedKanji) {
          button.classList.add('is-correct');
        } else if (option === item.selectedOption && option !== item.removedKanji) {
          button.classList.add('is-wrong');
        }
        button.disabled = true;
      } else {
        button.addEventListener('click', () => selectOption(option));
      }

      optionsEl.appendChild(button);
    });
  }

  if (feedback) {
    if (item.selectedOption) {
      feedback.classList.remove('hidden');
      feedback.textContent = getFeedbackMessage(item);
      feedback.classList.toggle('is-correct', item.selectedOption === item.removedKanji);
      feedback.classList.toggle('is-wrong', item.selectedOption !== item.removedKanji);
    } else {
      feedback.classList.add('hidden');
      feedback.textContent = '';
      feedback.classList.remove('is-correct', 'is-wrong');
    }
  }
}

function selectOption(option) {
  const item = state.quizItems[state.currentIndex];
  if (!item || item.selectedOption) {
    return;
  }

  item.selectedOption = option;
  state.answered = true;
  showCurrentQuiz();
  startAutoAdvance();
}

function navigateQuiz(direction, fromAutoAdvance = false) {
  if (!state.started) {
    return;
  }

  if (!fromAutoAdvance) {
    clearAutoAdvance();
  }

  if (direction === -1) {
    if (!state.quizItems.length) {
      return;
    }
    state.currentIndex = (state.currentIndex - 1 + state.quizItems.length) % state.quizItems.length;
    state.waitingForNext = false;
    showCurrentQuiz();
    return;
  }

  if (!state.answered && !state.waitingForNext) {
    return;
  }

  const nextIndex = state.currentIndex + 1;

  if (nextIndex < state.quizItems.length) {
    state.currentIndex = nextIndex;
    state.waitingForNext = false;
    showCurrentQuiz();
    return;
  }

  if (state.isGenerating) {
    state.currentIndex = nextIndex;
    showWaitingState();
    return;
  }

  if (state.quizItems.length > 0) {
    state.currentIndex = 0;
    state.waitingForNext = false;
    showCurrentQuiz();
  }
}

function bindEvents() {
  const startButton = document.getElementById('start-button');
  if (startButton) {
    startButton.addEventListener('click', () => {
      startQuiz();
    });
  }

  const prevButton = document.getElementById('prev-button');
  if (prevButton) {
    prevButton.addEventListener('click', () => navigateQuiz(-1));
  }

  const nextButton = document.getElementById('next-button');
  if (nextButton) {
    nextButton.addEventListener('click', () => navigateQuiz(1));
  }

  document.addEventListener('keydown', (event) => {
    if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      return;
    }

    if (!state.started) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigateQuiz(-1);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigateQuiz(1);
    }
  });
}

init();
