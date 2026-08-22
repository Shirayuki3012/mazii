/**
 * extract-kanji.js
 * Trích xuất các ký tự kanji (CJK) từ cards.json và lưu vào kanji.json.
 * Thay thế kanji_extract.py — chỉ giữ lại ký tự CJK thực sự (loại bỏ hiragana, katakana,
 * ký tự full-width, khoảng trắng, dấu câu...) khác với bản Python cũ.
 *
 * Cách dùng:
 *   node tools/extract-kanji.js
 */

const fs = require('fs');
const path = require('path');

const CARDS_FILE = path.join(__dirname, '..', 'data', 'cards.json');
const KANJI_FILE = path.join(__dirname, '..', 'data', 'kanji.json');

// CJK Unicode ranges cần giữ lại
function isCJK(ch) {
  const code = ch.codePointAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||   // CJK Unified Ideographs (phổ biến)
    (code >= 0x3400 && code <= 0x4dbf) ||   // CJK Extension A (ít phổ biến)
    (code >= 0xf900 && code <= 0xfaff)       // CJK Compatibility Ideographs
  );
}

console.log('=== Extract kanji từ cards.json ===\n');

if (!fs.existsSync(CARDS_FILE)) {
  console.error(`Lỗi: Không tìm thấy ${CARDS_FILE}`);
  process.exit(1);
}

const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));

// Load danh sách kanji đang có (nếu tồn tại)
const existing = fs.existsSync(KANJI_FILE)
  ? new Set(JSON.parse(fs.readFileSync(KANJI_FILE, 'utf8')))
  : new Set();

const before = existing.size;

for (const card of cards) {
  const word = String(card.word || '');
  for (const ch of word) {
    if (isCJK(ch)) {
      existing.add(ch);
    }
  }
}

const after = existing.size;
const added = after - before;

const result = [...existing].sort();

fs.writeFileSync(KANJI_FILE, JSON.stringify(result, null, 2));

console.log(`Đọc: ${cards.length} cards`);
console.log(`Trước: ${before} kanji — Sau: ${after} kanji`);
console.log(`Thêm mới: ${added} kanji`);
console.log(`Đã lưu vào: data/kanji.json`);
