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
    await loadProgress();
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

async function loadProgress() {
  try {
    const response = await fetch('/api/progress');
    const data = await response.json();
    state.stats.known = new Set(data.known || []);
    state.stats.unknown = new Set(data.unknown || []);
  } catch (e) {
    // Nếu lỗi thì giữ nguyên Set rỗng
  }
}

async function saveProgress() {
  try {
    await fetch('/api/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        known: [...state.stats.known],
        unknown: [...state.stats.unknown]
      })
    });
  } catch (e) {
    // Lỗi mạng — bỏ qua, không crash UI
  }
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

// Lọc bỏ các card không còn khớp filter ra khỏi currentCards hiện tại,
// giữ nguyên thứ tự (kể cả sau khi shuffle). Dùng khi mark known/unknown.
// Trả về true nếu có thay đổi (card hiện tại bị loại bỏ).
function applyFilterInPlace() {
  if (!isFlashcardPage() || state.filter === 'all') {
    return false;
  }

  const prevCard = state.currentCard;
  const prevIndex = state.currentIndex;

  state.currentCards = state.currentCards.filter(card => {
    if (state.filter === 'known') return state.stats.known.has(card.word);
    if (state.filter === 'unknown') return state.stats.unknown.has(card.word);
    if (state.filter === 'unmarked') return !state.stats.known.has(card.word) && !state.stats.unknown.has(card.word);
    return true;
  });

  if (!state.currentCards.length) {
    state.currentIndex = 0;
    state.currentCard = null;
    state.showingBack = false;
    return true;
  }

  // Nếu card trước vẫn còn trong danh sách, giữ index đó
  const newIndex = state.currentCards.indexOf(prevCard);
  if (newIndex !== -1) {
    state.currentIndex = newIndex;
    state.currentCard = prevCard;
    return false;
  }

  // Card đã bị loại — điều chỉnh index
  state.currentIndex = Math.min(prevIndex, state.currentCards.length - 1);
  state.currentCard = state.currentCards[state.currentIndex];
  state.showingBack = false;
  return true;
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

      const removed = applyFilterInPlace();
      if (!removed) navigateCard(1);
      updateStats();
      showCurrentCard();
      saveProgress();
    });
  }

  const unknownButton = document.getElementById('unknown-button');
  if (unknownButton) {
    unknownButton.addEventListener('click', () => {
      if (!state.currentCard) return;

      state.stats.unknown.add(state.currentCard.word);
      state.stats.known.delete(state.currentCard.word);

      const removed = applyFilterInPlace();
      if (!removed) navigateCard(1);
      updateStats();
      showCurrentCard();
      saveProgress();
    });
  }

  const flipButton = document.getElementById('flip-button');
  if (flipButton) {
    flipButton.addEventListener('click', () => {
      flipCard();
    });
  }

  const lookupButton = document.getElementById('lookup-button');
  if (lookupButton) {
    lookupButton.addEventListener('click', () => {
      if (!state.currentCard) return;
      const url = `https://mazii.net/vi-VN/search/word/javi/${encodeURIComponent(state.currentCard.word)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
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

      const removedUp = applyFilterInPlace();
      if (!removedUp) navigateCard(1);
      updateStats();
      showCurrentCard();
      saveProgress();
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!state.currentCard) return;
      state.stats.unknown.add(state.currentCard.word);
      state.stats.known.delete(state.currentCard.word);

      const removedDown = applyFilterInPlace();
      if (!removedDown) navigateCard(1);
      updateStats();
      showCurrentCard();
      saveProgress();
    }

    if (event.key === ' ') {
      event.preventDefault();
      flipCard();
    }

    if (event.key === '+') {
      event.preventDefault();
      if (!state.currentCard) return;
      const url = `https://mazii.net/vi-VN/search/word/javi/${encodeURIComponent(state.currentCard.word)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
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
      shuffleCards();
    });
  }

  const randomModeButton = document.getElementById('random-mode-button');
  if (randomModeButton) {
    randomModeButton.addEventListener('click', () => {
      state.randomMode = !state.randomMode;
      randomModeButton.textContent = `Ngẫu nhiên: ${state.randomMode ? 'bật' : 'tắt'}`;
      randomModeButton.classList.toggle('active', state.randomMode);

      if (state.randomMode) {
        shuffleCards();
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
      updateSelectedFileLabel(fileInput.files);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const chosenFileInput = event.target.querySelector('input[type="file"]');
    if (!chosenFileInput.files || !chosenFileInput.files.length) {
      const statusEl = document.getElementById('upload-status');
      if (statusEl) statusEl.textContent = 'Vui lòng chọn ít nhất một file Excel.';
      return;
    }

    await submitImportFiles([...chosenFileInput.files], event.target);
  });

  const filter = document.getElementById('level-filter');
  if (filter) {
    filter.addEventListener('change', () => {
      renderDataTable(filter.value || 'all');
    });
  }
}

function updateSelectedFileLabel(fileList) {
  const fileNameLabel = document.getElementById('file-name');
  if (!fileNameLabel) return;

  if (!fileList || !fileList.length) {
    fileNameLabel.textContent = 'Chọn file Excel (có thể chọn nhiều file)';
    return;
  }

  if (fileList.length === 1) {
    fileNameLabel.textContent = fileList[0].name;
    return;
  }

  fileNameLabel.textContent = `${fileList.length} file đã chọn: ${[...fileList].map((file) => file.name).join(', ')}`;
}

function appendImportFiles(formData, files) {
  files.forEach((file) => formData.append('excelFile', file));
}

async function submitImportFiles(files, form) {
  const formData = new FormData();
  appendImportFiles(formData, files);

  const levelSelector = document.getElementById('import-level');
  const level = levelSelector && levelSelector.value ? levelSelector.value : 'N5';
  const duplicateAction = document.getElementById('duplicate-action')?.value || 'ask';

  formData.append('level', level);
  formData.append('duplicateAction', duplicateAction);

  const statusEl = document.getElementById('upload-status');
  if (statusEl) {
    statusEl.textContent = files.length > 1
      ? `Đang tải ${files.length} file...`
      : 'Đang tải dữ liệu...';
  }

  const response = await fetch('/api/import', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();

  if (response.status === 409) {
    const resolvedAction = await showDuplicateModal(result);
    if (!resolvedAction) {
      if (statusEl) statusEl.textContent = 'Đã hủy nhập dữ liệu trùng lặp.';
      return;
    }

    await submitImportFilesWithAction(files, level, resolvedAction);
    return;
  }

  if (response.ok) {
    await handleImportSuccess(result);
    resetImportForm(form);
  } else if (statusEl) {
    statusEl.textContent = formatImportErrorMessage(result);
  }
}

async function submitImportFilesWithAction(files, level, duplicateAction) {
  const formData = new FormData();
  appendImportFiles(formData, files);
  formData.append('level', level);
  formData.append('duplicateAction', duplicateAction);

  const statusEl = document.getElementById('upload-status');
  if (statusEl) {
    statusEl.textContent = files.length > 1
      ? `Đang xử lý ${files.length} file trùng lặp...`
      : 'Đang xử lý dữ liệu trùng lặp...';
  }

  const response = await fetch('/api/import', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();

  if (response.ok) {
    await handleImportSuccess(result);
    resetImportForm(document.getElementById('import-form'));
  } else if (statusEl) {
    statusEl.textContent = formatImportErrorMessage(result);
  }
}

function formatImportErrorMessage(result) {
  const parts = [result.message || 'Không thể nhập dữ liệu.'];
  if (result.fileErrors?.length) {
    parts.push(result.fileErrors.map((item) => `${item.file}: ${item.message}`).join(' '));
  }
  return parts.join(' ');
}

async function handleImportSuccess(result) {
  await loadCards();
  if (isFlashcardPage()) {
    renderLevels();
    applyFilter();
    updateStats();
    showCurrentCard();
  }
  renderDataTable(document.getElementById('level-filter')?.value || 'all');

  const statusEl = document.getElementById('upload-status');
  if (!statusEl) return;

  const parts = [];
  if (result.fileCount > 1) {
    parts.push(`Đã xử lý ${result.fileCount} file`);
  }
  parts.push(`nhập thành công ${result.imported} từ`);
  if (result.overwritten) parts.push(`ghi đè ${result.overwritten} từ`);
  if (result.skipped) parts.push(`bỏ qua ${result.skipped} từ trùng`);
  if (result.fileDuplicateCount) {
    parts.push(`gộp ${result.fileDuplicateCount} dòng trùng trong file`);
  }
  if (result.fileErrors?.length) {
    parts.push(`cảnh báo: ${result.fileErrors.map((item) => item.file).join(', ')} không có dữ liệu hợp lệ`);
  }
  statusEl.textContent = `${parts.join(', ')}.`;
}

function resetImportForm(form) {
  if (!form) return;
  form.reset();
  updateSelectedFileLabel(null);
}

function showDuplicateModal(result) {
  const modal = document.getElementById('duplicate-modal');
  if (!modal) {
    const duplicateCount = result.conflictCount || (result.duplicates ? result.duplicates.length : 0);
    const duplicateNames = (result.duplicates || []).map((item) => item.word).slice(0, 5).join(', ');
    const shouldOverwrite = window.confirm(
      `Có ${duplicateCount} từ đã tồn tại: ${duplicateNames}${duplicateCount > 5 ? '...' : ''}. Ghi đè?`
    );
    if (shouldOverwrite) return 'overwrite';
    const shouldSkip = window.confirm(`Bỏ qua ${duplicateCount} từ đã tồn tại?`);
    return shouldSkip ? 'skip' : null;
  }

  const conflicts = result.conflicts || (result.duplicates || []).map((item) => ({
    imported: item,
    existing: null
  }));
  const conflictCount = result.conflictCount || conflicts.length;
  const fileDuplicateCount = result.fileDuplicateCount || 0;

  const summaryEl = document.getElementById('duplicate-modal-summary');
  if (summaryEl) {
    let summary = `Có ${conflictCount} từ trùng với dữ liệu hiện có. Chọn cách xử lý trước khi tiếp tục.`;
    if (result.fileCount > 1) {
      summary = `Đang nhập ${result.fileCount} file. ${summary}`;
    }
    if (fileDuplicateCount) {
      summary += ` (${fileDuplicateCount} dòng trùng giữa các file sẽ được gộp tự động.)`;
    }
    summaryEl.textContent = summary;
  }

  const tableBody = document.getElementById('duplicate-table-body');
  if (tableBody) {
    tableBody.innerHTML = '';
    conflicts.slice(0, 50).forEach((conflict) => {
      const row = document.createElement('tr');

      const wordCell = document.createElement('td');
      wordCell.className = 'word-cell';
      wordCell.textContent = conflict.imported?.word || '';

      const existingCell = document.createElement('td');
      existingCell.innerHTML = renderDuplicatePreview(conflict.existing);

      const importedCell = document.createElement('td');
      importedCell.innerHTML = renderDuplicatePreview(conflict.imported);

      row.appendChild(wordCell);
      row.appendChild(existingCell);
      row.appendChild(importedCell);
      tableBody.appendChild(row);
    });

    if (conflicts.length > 50) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.textContent = `... và ${conflicts.length - 50} từ trùng khác`;
      cell.style.color = 'var(--text-soft)';
      row.appendChild(cell);
      tableBody.appendChild(row);
    }
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    const overwriteBtn = document.getElementById('duplicate-overwrite-btn');
    const skipBtn = document.getElementById('duplicate-skip-btn');
    const cancelBtn = document.getElementById('duplicate-cancel-btn');
    const backdrop = modal.querySelector('[data-close-duplicate-modal]');

    function closeModal(action) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      overwriteBtn?.removeEventListener('click', onOverwrite);
      skipBtn?.removeEventListener('click', onSkip);
      cancelBtn?.removeEventListener('click', onCancel);
      backdrop?.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeyDown);
      resolve(action);
    }

    function onOverwrite() {
      closeModal('overwrite');
    }

    function onSkip() {
      closeModal('skip');
    }

    function onCancel() {
      closeModal(null);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    overwriteBtn?.addEventListener('click', onOverwrite);
    skipBtn?.addEventListener('click', onSkip);
    cancelBtn?.addEventListener('click', onCancel);
    backdrop?.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeyDown);
  });
}

function renderDuplicatePreview(card) {
  if (!card) {
    return '<span class="duplicate-card-preview">—</span>';
  }

  return `<div class="duplicate-card-preview">
    <strong>${escapeHtml(card.phonetic || '')}</strong>
    <span>${escapeHtml(card.mean || '')}</span>
    <span>Level: ${escapeHtml(card.level || '')}</span>
  </div>`;
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

function shuffleCards() {
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
  if (flashcard) {
    if (!isFlipped && flashcard.classList.contains('is-flipped')) {
      // Đang reset về mặt trước — tắt transition trực tiếp trên các face
      const faces = flashcard.querySelectorAll('.front-face, .back-face');
      faces.forEach(f => f.style.transition = 'none');
      flashcard.classList.remove('is-flipped');
      // Force reflow để browser chốt vị trí mới
      void flashcard.offsetWidth;
      faces.forEach(f => f.style.transition = '');
    } else {
      flashcard.classList.toggle('is-flipped', isFlipped);
    }
  }
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
