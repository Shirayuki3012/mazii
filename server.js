const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const KANJI_SERVER_URL = process.env.KANJI_SERVER_URL || 'http://localhost:3001';
const DATA_DIR = path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function initializeCards() {
  if (!fs.existsSync(CARDS_FILE)) {
    // Tạo file rỗng nếu chưa tồn tại
    fs.writeFileSync(CARDS_FILE, JSON.stringify([], null, 2));
  }
}

function createStableCardId(card, index) {
  const wordPart = normalizeWord(card.word || card.Word || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'word';

  const levelPart = normalizeWord(card.level || 'N5').toUpperCase();
  return `card-${wordPart}-${levelPart}-${index}`;
}

function createCardReference(card, index) {
  const id = normalizeWord(card.id || '') || createStableCardId(card, index);

  return {
    id,
    word: normalizeWord(card.word),
    phonetic: normalizeWord(card.phonetic),
    mean: normalizeWord(card.mean),
    level: normalizeWord(card.level).toUpperCase()
  };
}

initializeCards();

function readProgress() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) {
      return { known: [], unknown: [] };
    }
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      known: Array.isArray(parsed.known) ? parsed.known : [],
      unknown: Array.isArray(parsed.unknown) ? parsed.unknown : []
    };
  } catch (error) {
    console.error('Error reading progress.json:', error);
    return { known: [], unknown: [] };
  }
}

function writeProgress(known, unknown) {
  const data = { known, unknown };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

function readCards() {
  try {
    const raw = fs.readFileSync(CARDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed.map((card, index) => createCardReference(card, index));

    const shouldWrite = JSON.stringify(normalized) !== raw;
    if (shouldWrite) {
      fs.writeFileSync(CARDS_FILE, JSON.stringify(normalized, null, 2));
    }

    return normalized;
  } catch (error) {
    console.error('Error reading cards.json:', error);
    return null;
  }
}

function normalizeWord(value) {
  return String(value || '').trim();
}

function getWordKey(word) {
  return normalizeWord(word).toLowerCase();
}

function dedupeImportedByWord(imported) {
  const byWord = new Map();
  let fileDuplicateCount = 0;

  imported.forEach((card) => {
    const key = getWordKey(card.word);
    if (byWord.has(key)) {
      fileDuplicateCount += 1;
    }
    byWord.set(key, card);
  });

  return {
    unique: [...byWord.values()],
    fileDuplicateCount
  };
}

function findImportConflicts(imported, existing) {
  const existingByWord = new Map(existing.map((card) => [getWordKey(card.word), card]));

  return imported
    .filter((card) => existingByWord.has(getWordKey(card.word)))
    .map((card) => ({
      imported: card,
      existing: existingByWord.get(getWordKey(card.word))
    }));
}

function mergeImportedCards(existing, imported, duplicateAction) {
  const { unique, fileDuplicateCount } = dedupeImportedByWord(imported);
  const conflicts = findImportConflicts(unique, existing);
  const conflictCount = conflicts.length;

  if (conflictCount && duplicateAction === 'ask') {
    return { type: 'conflict', conflicts, conflictCount, fileDuplicateCount };
  }

  if (duplicateAction === 'overwrite') {
    const next = [...existing];

    unique.forEach((card) => {
      const existingIndex = next.findIndex((item) => getWordKey(item.word) === getWordKey(card.word));
      if (existingIndex >= 0) {
        next[existingIndex] = {
          ...next[existingIndex],
          word: card.word,
          phonetic: card.phonetic,
          mean: card.mean,
          level: card.level
        };
      } else {
        next.push(card);
      }
    });

    return {
      type: 'success',
      cards: next,
      imported: unique.length,
      overwritten: conflictCount,
      skipped: 0,
      fileDuplicateCount
    };
  }

  if (duplicateAction === 'skip') {
    const existingWords = new Set(existing.map((card) => getWordKey(card.word)));
    const toAdd = unique.filter((card) => !existingWords.has(getWordKey(card.word)));
    const merged = [...existing, ...toAdd];

    return {
      type: 'success',
      cards: merged,
      imported: toAdd.length,
      overwritten: 0,
      skipped: conflictCount,
      fileDuplicateCount
    };
  }

  if (conflictCount) {
    return { type: 'conflict', conflicts, conflictCount, fileDuplicateCount };
  }

  const merged = [...existing, ...unique];
  return {
    type: 'success',
    cards: merged,
    imported: unique.length,
    overwritten: 0,
    skipped: 0,
    fileDuplicateCount
  };
}

function cleanupUploadedFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function parseExcelFile(filePath, defaultLevel = 'N5') {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  const imported = [];

  rows.forEach((row, index) => {
    const word = normalizeWord(row.word || row.Word || row['word']);
    const phonetic = normalizeWord(row.phonetic || row.Phonetic || row['phonetic']);
    const mean = normalizeWord(row.mean || row.meaning || row.Mean || row['mean']);
    const rawLevel = normalizeWord(row.level || row.Level || row['level'] || defaultLevel);
    const level = rawLevel.toUpperCase().replace(/JLPT/i, '').trim() || defaultLevel.toUpperCase();

    if (word && phonetic && mean) {
      const card = {
        word,
        phonetic,
        mean,
        level
      };

      imported.push(createCardReference(card, index));
    }
  });

  return imported;
}

function parseExcelFiles(fileEntries, defaultLevel = 'N5') {
  const imported = [];
  const fileErrors = [];

  fileEntries.forEach(({ path: filePath, originalname }) => {
    try {
      const rows = parseExcelFile(filePath, defaultLevel);
      if (!rows.length) {
        fileErrors.push({ file: originalname, message: 'Không có dữ liệu hợp lệ.' });
        return;
      }
      imported.push(...rows);
    } catch (error) {
      fileErrors.push({ file: originalname, message: 'Không đọc được file.' });
    }
  });

  return { imported, fileErrors };
}

function cleanupUploadedFiles(filePaths) {
  filePaths.forEach((filePath) => cleanupUploadedFile(filePath));
}

app.get('/api/cards', (req, res) => {
  const cards = readCards();
  res.json({ cards });
});

app.get('/api/levels', (req, res) => {
  const cards = readCards();
  const levels = [...new Set(cards.map(card => card.level))].sort();
  res.json({ levels });
});

app.get('/api/progress', (req, res) => {
  const progress = readProgress();
  res.json(progress);
});

app.put('/api/progress', (req, res) => {
  const payload = req.body || {};
  const known = Array.isArray(payload.known) ? payload.known.map(String) : [];
  const unknown = Array.isArray(payload.unknown) ? payload.unknown.map(String) : [];

  try {
    writeProgress(known, unknown);
    res.json({ message: 'Đã lưu tiến độ.', known: known.length, unknown: unknown.length });
  } catch (error) {
    console.error('Error writing progress.json:', error);
    res.status(500).json({ message: 'Không thể lưu tiến độ.' });
  }
});

app.put('/api/cards/:id', (req, res) => {
  const id = req.params.id;
  const payload = req.body || {};

  const word = normalizeWord(payload.word);
  const phonetic = normalizeWord(payload.phonetic);
  const mean = normalizeWord(payload.mean);
  const level = normalizeWord(payload.level || 'N5').toUpperCase();

  if (!word || !phonetic || !mean || !level) {
    return res.status(400).json({ message: 'Thiếu dữ liệu từ cần cập nhật.' });
  }

  const cards = readCards();
  const cardIndex = cards.findIndex((card) => String(card.id) === String(id));

  if (cardIndex === -1) {
    return res.status(404).json({ message: 'Không tìm thấy từ để cập nhật.' });
  }

  cards[cardIndex] = {
    ...cards[cardIndex],
    word,
    phonetic,
    mean,
    level
  };

  fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
  res.json({ message: 'Cập nhật từ thành công', card: cards[cardIndex] });
});

app.delete('/api/cards/:id', (req, res) => {
  const id = req.params.id;
  const cards = readCards();
  const nextCards = cards.filter((card) => String(card.id) !== String(id));

  if (nextCards.length === cards.length) {
    return res.status(404).json({ message: 'Không tìm thấy từ để xóa.' });
  }

  fs.writeFileSync(CARDS_FILE, JSON.stringify(nextCards, null, 2));
  res.json({ message: 'Xóa từ thành công', deletedId: id, total: nextCards.length });
});

app.post('/api/import', multer({ dest: UPLOADS_DIR }).array('excelFile', 50), (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ message: 'Vui lòng chọn ít nhất một file Excel.' });
  }

  const filePaths = files.map((file) => file.path);
  const requestedLevel = normalizeWord(req.body.level || 'N5').toUpperCase() || 'N5';
  const duplicateAction = normalizeWord(req.body.duplicateAction || 'ask').toLowerCase() || 'ask';

  try {
    const { imported, fileErrors } = parseExcelFiles(
      files.map((file) => ({ path: file.path, originalname: file.originalname })),
      requestedLevel
    );

    if (!imported.length) {
      cleanupUploadedFiles(filePaths);
      return res.status(400).json({
        message: 'Không có dữ liệu hợp lệ trong các file đã chọn.',
        fileCount: files.length,
        fileErrors
      });
    }

    const existing = readCards();
    const result = mergeImportedCards(existing, imported, duplicateAction);

    if (result.type === 'conflict') {
      cleanupUploadedFiles(filePaths);
      return res.status(409).json({
        message: 'Có từ đã tồn tại trong dữ liệu hiện có.',
        duplicates: result.conflicts.map((item) => item.imported),
        conflicts: result.conflicts,
        conflictCount: result.conflictCount,
        fileDuplicateCount: result.fileDuplicateCount,
        fileCount: files.length,
        fileErrors
      });
    }

    fs.writeFileSync(CARDS_FILE, JSON.stringify(result.cards, null, 2));
    cleanupUploadedFiles(filePaths);

    const response = {
      message: result.skipped ? 'Bỏ qua các từ đã tồn tại' : 'Nhập dữ liệu thành công',
      imported: result.imported,
      total: result.cards.length,
      skipped: result.skipped,
      overwritten: result.overwritten,
      fileDuplicateCount: result.fileDuplicateCount,
      fileCount: files.length,
      fileErrors
    };

    res.json(response);
  } catch (error) {
    cleanupUploadedFiles(filePaths);
    console.error(error);
    res.status(400).json({ message: 'Không thể đọc một hoặc nhiều file Excel. Cần cột: word, phonetic, mean.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/kanji-health', async (req, res) => {
  try {
    const response = await fetch(`${KANJI_SERVER_URL}/api/health`, {
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      return res.status(502).json({
        available: false,
        message: 'Kanji server không phản hồi.'
      });
    }

    const data = await response.json();
    res.json({
      available: true,
      status: data.status,
      kanji_count: data.kanji_count,
      cache_count: data.cache_count
    });
  } catch (error) {
    console.error('Kanji server health check failed:', error);
    res.status(502).json({
      available: false,
      message: 'Kanji server không khả dụng. Chạy: python kanji_server.py'
    });
  }
});

app.post('/api/similar-kanji', async (req, res) => {
  try {
    const response = await fetch(`${KANJI_SERVER_URL}/api/similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Kanji server error:', error);
    res.status(502).json({ message: 'Kanji server không khả dụng. Chạy: python kanji_server.py' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

app.get('/data', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'data.html'));
});

app.listen(PORT, () => {
  console.log(`Japanese Flashcard app is running on http://localhost:${PORT}`);
});
