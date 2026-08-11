const state = {
  cards: [],
  selectedLevels: new Set(['N5', 'N4', 'N3', 'N2', 'N1']),
  filter: 'all',
  randomMode: false,
  currentIndex: 0,
  currentCard: null,
  showingBack: false,
  stats: {
    known: new Set(),
    unknown: new Set()
  }
};

const levelLabels = ['N5', 'N4', 'N3', 'N2', 'N1'];

async function init() {
  await loadCards();

  if (isFlashcardPage()) {
    renderLevels();
    bindFlashcardEvents();
    applyFilter();
    updateStats();
    showCurrentCard();
  }

  if (isDataPage()) {
    bindDataPageEvents();
    renderDataTable();
  }
}

function isFlashcardPage() {
  return Boolean(document.getElementById('level-list')) && Boolean(document.getElementById('flashcard-button'));
}

function isDataPage() {
  return Boolean(document.getElementById('cards-table-body')) && Boolean(document.getElementById('import-form'));
}

async function loadCards() {
  const response = await fetch('/api/cards');
  const data = await response.json();
  state.cards = data.cards;
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
    const count = state.cards.filter(card => card.level === level).length;
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

      state.currentIndex = 0;
      renderLevels();
      applyFilter();
      updateStats();
      showCurrentCard();
    });

    levelList.appendChild(button);
  });
}

function applyFilter() {
  if (!isFlashcardPage()) {
    state.currentCards = [];
    state.currentCard = null;
    return;
  }

  const selectedLevels = [...state.selectedLevels];
  const activeCards = state.cards.filter(card => selectedLevels.includes(card.level));

  if (state.filter === 'known') {
    state.currentCards = activeCards.filter(card => state.stats.known.has(card.word));
  } else if (state.filter === 'unknown') {
    state.currentCards = activeCards.filter(card => state.stats.unknown.has(card.word));
  } else if (state.filter === 'unmarked') {
    state.currentCards = activeCards.filter(card => !state.stats.known.has(card.word) && !state.stats.unknown.has(card.word));
  } else {
    state.currentCards = activeCards;
  }

  if (state.currentIndex >= state.currentCards.length) {
    state.currentIndex = 0;
  }

  if (!state.currentCards.length) {
    state.currentCard = null;
  } else {
    state.currentCard = state.currentCards[state.currentIndex];
  }
}

function bindFlashcardEvents() {
  document.querySelectorAll('input[name="studyFilter"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      state.filter = event.target.value;
      state.currentIndex = 0;
      applyFilter();
      updateStats();
      showCurrentCard();
    });
  });

  const prevButton = document.getElementById('prev-button');
  if (prevButton) {
    prevButton.addEventListener('click', () => {
      navigateCard(-1);
    });
  }

  const nextButton = document.getElementById('next-button');
  if (nextButton) {
    nextButton.addEventListener('click', () => {
      navigateCard(1);
    });
  }

  const knownButton = document.getElementById('known-button');
  if (knownButton) {
    knownButton.addEventListener('click', () => {
      if (!state.currentCard) return;

      state.stats.known.add(state.currentCard.word);
      state.stats.unknown.delete(state.currentCard.word);

      navigateCard(1);
      applyFilter();
      updateStats();
      showCurrentCard();
    });
  }

  const unknownButton = document.getElementById('unknown-button');
  if (unknownButton) {
    unknownButton.addEventListener('click', () => {
      if (!state.currentCard) return;

      state.stats.unknown.add(state.currentCard.word);
      state.stats.known.delete(state.currentCard.word);

      navigateCard(1);
      applyFilter();
      updateStats();
      showCurrentCard();
    });
  }

  const flipButton = document.getElementById('flip-button');
  if (flipButton) {
    flipButton.addEventListener('click', () => {
      flipCard();
    });
  }

  const flashcardButton = document.getElementById('flashcard-button');
  if (flashcardButton) {
    flashcardButton.addEventListener('click', () => {
      flipCard();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigateCard(-1);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigateCard(1);
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!state.currentCard) return;
      state.stats.known.add(state.currentCard.word);
      state.stats.unknown.delete(state.currentCard.word);

      navigateCard(1);
      applyFilter();
      updateStats();
      showCurrentCard();
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!state.currentCard) return;
      state.stats.unknown.add(state.currentCard.word);
      state.stats.known.delete(state.currentCard.word);

      navigateCard(1);
      applyFilter();
      updateStats();
      showCurrentCard();
    }

    if (event.key === ' ') {
      event.preventDefault();
      flipCard();
    }
  });

  const startButton = document.getElementById('start-button');
  if (startButton) {
    startButton.addEventListener('click', () => {
      state.currentIndex = 0;
      state.showingBack = false;
      applyFilter();
      showCurrentCard();
    });
  }

  const shuffleButton = document.getElementById('shuffle-button');
  if (shuffleButton) {
    shuffleButton.addEventListener('click', () => {
      shuffleCurrentCards();
    });
  }

  const randomModeButton = document.getElementById('random-mode-button');
  if (randomModeButton) {
    randomModeButton.addEventListener('click', () => {
      state.randomMode = !state.randomMode;
      randomModeButton.textContent = `Ngẫu nhiên: ${state.randomMode ? 'bật' : 'tắt'}`;
      randomModeButton.classList.toggle('active', state.randomMode);

      if (state.randomMode) {
        shuffleCurrentCards();
      } else {
        state.currentCards = state.currentCards.sort((a, b) => {
          const aIndex = state.cards.findIndex(item => item.word === a.word);
          const bIndex = state.cards.findIndex(item => item.word === b.word);
          return aIndex - bIndex;
        });
        state.currentIndex = 0;
        state.currentCard = state.currentCards[0] || null;
        showCurrentCard();
      }
    });
  }
}

function bindDataPageEvents() {
  const form = document.getElementById('import-form');
  if (!form) return;

  const fileInput = form.querySelector('input[type="file"]');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const fileName = fileInput.files && fileInput.files[0] ? fileInput.files[0].name : 'Chọn file Excel';
      const fileNameLabel = document.getElementById('file-name');
      if (fileNameLabel) {
        fileNameLabel.textContent = fileName;
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const chosenFileInput = event.target.querySelector('input[type="file"]');
    if (!chosenFileInput.files || !chosenFileInput.files.length) {
      const statusEl = document.getElementById('upload-status');
      if (statusEl) statusEl.textContent = 'Vui lòng chọn file Excel.';
      return;
    }

    await submitImportFile(chosenFileInput.files[0], event.target);
  });

  const filter = document.getElementById('level-filter');
  if (filter) {
    filter.addEventListener('change', () => {
      renderDataTable(filter.value || 'all');
    });
  }
}

async function submitImportFile(file, form) {
  const formData = new FormData();
  formData.append('excelFile', file);

  const levelSelector = document.getElementById('import-level');
  const level = levelSelector && levelSelector.value ? levelSelector.value : 'N5';
  const duplicateAction = document.getElementById('duplicate-action')?.value || 'ask';

  formData.append('level', level);
  formData.append('duplicateAction', duplicateAction);

  const statusEl = document.getElementById('upload-status');
  if (statusEl) statusEl.textContent = 'Đang tải dữ liệu...';

  const response = await fetch('/api/import', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();

  if (response.status === 409) {
    const duplicateCount = result.conflictCount || (result.duplicates ? result.duplicates.length : 0);
    const duplicateNames = (result.duplicates || []).map(item => item.word).slice(0, 5).join(', ');

    const shouldOverwrite = window.confirm(
      `Có ${duplicateCount} từ đã tồn tại trong dữ liệu hiện có: ${duplicateNames}${duplicateCount > 5 ? '...' : ''}. Ghi đè lên các từ này?`
    );

    if (shouldOverwrite) {
      await submitImportFileWithAction(file, level, 'overwrite');
      return;
    }

    const shouldSkip = window.confirm(`Bỏ qua ${duplicateCount} từ đã tồn tại?`);
    if (shouldSkip) {
      await submitImportFileWithAction(file, level, 'skip');
      return;
    }

    if (statusEl) statusEl.textContent = 'Đã hủy nhập dữ liệu trùng lặp.';
    return;
  }

  if (response.ok) {
    await loadCards();
    if (isFlashcardPage()) {
      renderLevels();
      applyFilter();
      updateStats();
      showCurrentCard();
    }
    renderDataTable(document.getElementById('level-filter')?.value || 'all');
    if (statusEl) statusEl.textContent = `Nhập thành công ${result.imported} từ.`;
  } else {
    if (statusEl) statusEl.textContent = result.message || 'Không thể nhập dữ liệu.';
  }

  form.reset();
  const fileNameLabel = document.getElementById('file-name');
  if (fileNameLabel) {
    fileNameLabel.textContent = 'Chọn file Excel';
  }
}

async function submitImportFileWithAction(file, level, duplicateAction) {
  const formData = new FormData();
  formData.append('excelFile', file);
  formData.append('level', level);
  formData.append('duplicateAction', duplicateAction);

  const statusEl = document.getElementById('upload-status');
  if (statusEl) statusEl.textContent = 'Đang xử lý dữ liệu trùng lặp...';

  const response = await fetch('/api/import', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();

  if (response.ok) {
    await loadCards();
    if (isFlashcardPage()) {
      renderLevels();
      applyFilter();
      updateStats();
      showCurrentCard();
    }
    renderDataTable(document.getElementById('level-filter')?.value || 'all');
    if (statusEl) statusEl.textContent = `Nhập thành công ${result.imported} từ.`;
  } else {
    if (statusEl) statusEl.textContent = result.message || 'Không thể nhập dữ liệu.';
  }

  const importForm = document.getElementById('import-form');
  if (importForm) {
    importForm.reset();
  }

  const fileNameLabel = document.getElementById('file-name');
  if (fileNameLabel) {
    fileNameLabel.textContent = 'Chọn file Excel';
  }
}

function renderDataTable(filterLevel = 'all') {
  const tableBody = document.getElementById('cards-table-body');
  if (!tableBody) return;

  tableBody.innerHTML = '';

  const cards = state.cards.filter((card) => {
    return filterLevel === 'all' || card.level === filterLevel;
  });

  cards.forEach(card => {
    const row = document.createElement('tr');

    const wordCell = document.createElement('td');
    wordCell.textContent = card.word;

    const phoneticCell = document.createElement('td');
    phoneticCell.textContent = card.phonetic;

    const meanCell = document.createElement('td');
    meanCell.textContent = card.mean;

    const levelCell = document.createElement('td');
    levelCell.textContent = card.level;

    const actionCell = document.createElement('td');
    actionCell.className = 'action-cell';

    const editButton = document.createElement('button');
    editButton.className = 'small-button edit-button';
    editButton.type = 'button';
    editButton.textContent = 'Sửa';
    editButton.addEventListener('click', () => {
      startEditRow(row, card);
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'small-button delete-button';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Xóa';
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm(`Xóa từ "${card.word}" khỏi danh sách?`)) {
        return;
      }

      const response = await fetch(`/api/cards/${encodeURIComponent(card.id)}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.message || 'Không thể xóa từ.');
        return;
      }

      await loadCards();
      if (isFlashcardPage()) {
        renderLevels();
        applyFilter();
        updateStats();
        showCurrentCard();
      }
      renderDataTable(document.getElementById('level-filter')?.value || 'all');
    });

    actionCell.appendChild(editButton);
    actionCell.appendChild(deleteButton);

    row.appendChild(wordCell);
    row.appendChild(phoneticCell);
    row.appendChild(meanCell);
    row.appendChild(levelCell);
    row.appendChild(actionCell);

    tableBody.appendChild(row);
  });
}

function startEditRow(row, card) {
  const cells = row.children;

  cells[0].innerHTML = `<input class="inline-editor" data-field="word" value="${escapeHtml(card.word)}" />`;
  cells[1].innerHTML = `<input class="inline-editor" data-field="phonetic" value="${escapeHtml(card.phonetic)}" />`;
  cells[2].innerHTML = `<input class="inline-editor" data-field="mean" value="${escapeHtml(card.mean)}" />`;
  cells[3].innerHTML = `<select class="inline-editor" data-field="level">
    <option value="N5" ${card.level === 'N5' ? 'selected' : ''}>N5</option>
    <option value="N4" ${card.level === 'N4' ? 'selected' : ''}>N4</option>
    <option value="N3" ${card.level === 'N3' ? 'selected' : ''}>N3</option>
    <option value="N2" ${card.level === 'N2' ? 'selected' : ''}>N2</option>
    <option value="N1" ${card.level === 'N1' ? 'selected' : ''}>N1</option>
  </select>`;

  const actionCell = cells[4];
  actionCell.innerHTML = '';

  const saveButton = document.createElement('button');
  saveButton.className = 'small-button save-button';
  saveButton.type = 'button';
  saveButton.textContent = 'Lưu';
  saveButton.addEventListener('click', async () => {
    const payload = {
      word: row.querySelector('[data-field="word"]')?.value,
      phonetic: row.querySelector('[data-field="phonetic"]')?.value,
      mean: row.querySelector('[data-field="mean"]')?.value,
      level: row.querySelector('[data-field="level"]')?.value
    };

    const response = await fetch(`/api/cards/${encodeURIComponent(card.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      alert(result.message || 'Cập nhật không thành công.');
      return;
    }

    await loadCards();
    if (isFlashcardPage()) {
      renderLevels();
      applyFilter();
      updateStats();
      showCurrentCard();
    }
    renderDataTable(document.getElementById('level-filter')?.value || 'all');
  });

  const cancelButton = document.createElement('button');
  cancelButton.className = 'small-button cancel-button';
  cancelButton.type = 'button';
  cancelButton.textContent = 'Hủy';
  cancelButton.addEventListener('click', () => {
    renderDataTable(document.getElementById('level-filter')?.value || 'all');
  });

  actionCell.appendChild(saveButton);
  actionCell.appendChild(cancelButton);
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function navigateCard(direction) {
  if (!state.currentCards || state.currentCards.length === 0) {
    return;
  }

  if (state.randomMode) {
    const nextIndex = Math.floor(Math.random() * state.currentCards.length);
    state.currentIndex = nextIndex;
  } else {
    if (direction === -1) {
      state.currentIndex = (state.currentIndex - 1 + state.currentCards.length) % state.currentCards.length;
    } else {
      state.currentIndex = (state.currentIndex + 1) % state.currentCards.length;
    }
  }

  state.currentCard = state.currentCards[state.currentIndex];
  state.showingBack = false;
  showCurrentCard();
}

function flipCard() {
  if (!state.currentCard) {
    return;
  }

  state.showingBack = !state.showingBack;
  const flashcard = document.getElementById('flashcard-button');
  flashcard.classList.toggle('is-flipped', state.showingBack);
}

function shuffleCurrentCards() {
  if (!state.currentCards || state.currentCards.length <= 1) {
    return;
  }

  for (let i = state.currentCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.currentCards[i], state.currentCards[j]] = [state.currentCards[j], state.currentCards[i]];
  }

  state.currentIndex = 0;
  state.currentCard = state.currentCards[0];
  state.showingBack = false;
  showCurrentCard();
}

function showCurrentCard() {
  if (!isFlashcardPage()) {
    return;
  }

  const flashcard = document.getElementById('flashcard-button');
  const card = state.currentCard;

  if (!card) {
    const word = document.getElementById('word-text');
    const backWord = document.getElementById('back-word');
    const backPhonetic = document.getElementById('back-phonetic');
    const mean = document.getElementById('mean-text');
    const cardLevel = document.getElementById('card-level');
    const cardIndex = document.getElementById('card-index');
    const progressBar = document.getElementById('progress-bar');

    if (word) word.textContent = 'Không có dữ liệu';
    if (backWord) backWord.textContent = '';
    if (backPhonetic) backPhonetic.textContent = '';
    if (mean) mean.textContent = '';
    if (cardLevel) cardLevel.textContent = '-';
    if (cardIndex) cardIndex.textContent = '0/0';
    if (flashcard) flashcard.classList.remove('is-flipped');
    if (progressBar) progressBar.style.width = '0%';
    return;
  }

  const word = document.getElementById('word-text');
  const backWord = document.getElementById('back-word');
  const backPhonetic = document.getElementById('back-phonetic');
  const mean = document.getElementById('mean-text');
  const cardLevel = document.getElementById('card-level');
  const backLevel = document.getElementById('back-level');
  const cardIndex = document.getElementById('card-index');
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');

  if (word) word.textContent = card.word;
  if (backWord) backWord.textContent = card.word;
  if (backPhonetic) backPhonetic.textContent = card.phonetic;
  if (mean) mean.textContent = card.mean;
  if (cardLevel) cardLevel.textContent = card.level;
  if (backLevel) backLevel.textContent = `Level ${card.level}`;

  const total = Math.max(state.currentCards.length, 1);
  const indexDisplay = state.currentCards.length ? `${state.currentIndex + 1}/${total}` : '0/0';
  if (cardIndex) cardIndex.textContent = indexDisplay;

  const progressPercent = total > 0 ? Math.round(((state.currentIndex + 1) / total) * 100) : 0;
  if (progressText) progressText.textContent = `${progressPercent}%`;
  if (progressBar) progressBar.style.width = `${progressPercent}%`;

  const isFlipped = state.showingBack;
  if (flashcard) flashcard.classList.toggle('is-flipped', isFlipped);
}

function updateStats() {
  if (!isFlashcardPage()) {
    return;
  }

  const selected = state.cards.filter(card => state.selectedLevels.has(card.level));
  const known = selected.filter(card => state.stats.known.has(card.word)).length;
  const unknown = selected.filter(card => state.stats.unknown.has(card.word)).length;
  const unmarked = selected.filter(card => !state.stats.known.has(card.word) && !state.stats.unknown.has(card.word)).length;

  const totalCount = document.getElementById('total-count');
  const knownCount = document.getElementById('known-count');
  const unknownCount = document.getElementById('unknown-count');
  const unmarkedCount = document.getElementById('unmarked-count');

  if (totalCount) totalCount.textContent = `${selected.length}`;
  if (knownCount) knownCount.textContent = `${known}`;
  if (unknownCount) unknownCount.textContent = `${unknown}`;
  if (unmarkedCount) unmarkedCount.textContent = `${unmarked}`;

  levelLabels.forEach(level => {
    const count = state.cards.filter(card => card.level === level).length;
    const levelButton = document.querySelector(`[data-level="${level}"]`);
    if (levelButton) {
      const countEl = levelButton.querySelector('.level-count');
      if (countEl) {
        countEl.textContent = count;
      }
    }
  });
}

init();
