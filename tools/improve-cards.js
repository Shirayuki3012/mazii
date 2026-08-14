/**
 * improve-cards.js
 * Dùng Gemini API để chuẩn hóa phonetic và nghĩa của flashcard.
 *
 * Cách dùng:
 *   node tools/improve-cards.js
 *
 * Biến môi trường:
 *   GEMINI_API_KEY  — API key của Gemini (bắt buộc)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load .env thủ công (không cần cài dotenv)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8')
    .split('\n')
    .forEach((line) => {
      const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    });
}

// ─── Cấu hình ────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const CARDS_FILE = path.join(__dirname, '..', 'data', 'cards.json');
const LOG_FILE = path.join(__dirname, '..', 'data', 'improve-log.jsonl');

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(card) {
  return `Bạn là chuyên gia tiếng Nhật. Hãy chuẩn hóa flashcard từ vựng tiếng Nhật sau theo đúng các quy tắc dưới đây, rồi trả về JSON hợp lệ DUY NHẤT (không có markdown, không có giải thích thêm).

Từ: ${card.word}
Phonetic hiện tại: ${card.phonetic}
Nghĩa hiện tại: ${card.mean}
Cấp độ: ${card.level}

QUY TẮC:

1. PHONETIC — Chỉ giữ cách đọc phổ biến, hiện đại. Bỏ cách đọc cổ không còn dùng.
   - Nếu từ có nhiều cách đọc phổ biến, liệt kê cách nhau bằng "・"
   - Với katakana thì giữ nguyên katakana

2. MEAN — Viết nghĩa ngắn gọn, dùng từ chuẩn tiếng Việt.
   - Không dùng từ đồng nghĩa thừa (ví dụ: chỉ "đinh", không phải "đanh; đinh")
   - Với từ katakana: ghi rõ nguồn gốc ngoại ngữ trong ngoặc, ví dụ: "thẻ (← card/英)"
   - Nếu từ chỉ có MỘT cách đọc, hoặc các cách đọc khác nhau chỉ do BIẾN ÂM / on'yomi cùng gốc mà KHÔNG khác nghĩa:
     → viết nghĩa thẳng, các nghĩa cách nhau bằng "; "
     → ví dụ 上京: "じょうきょう: lên Tokyo; かみきょう: vùng Kamigyo (địa danh Kyoto)"
   - Nếu từ có các cách đọc mang NGHĨA HOÀN TOÀN KHÁC NHAU (không phải biến âm):
     → viết theo dạng "cách_đọc: nghĩa" cho từng cách đọc, phân cách bằng "; "
     → ví dụ 柄: "がら: hoa văn, họa tiết; え: cán, tay cầm; から: xuất thân, phẩm cách; つか: chuôi kiếm"
   - Nếu một cách đọc chỉ dùng trong VĂN CHƯƠNG, ghi "(văn chương)" sau nghĩa đó
     → ví dụ 頬: "ほお: má; ほほ: má (văn chương)"
   - Nếu một cách đọc chỉ dùng trong ĐỊA DANH hoặc TÊN NGƯỜI, ghi "(địa danh)" hoặc "(tên người)"

Trả về JSON theo đúng cấu trúc sau (giữ nguyên id và level, KHÔNG thay đổi word):
{
  "id": "${card.id}",
  "word": "${card.word}",
  "phonetic": "<cách đọc đã chuẩn hóa>",
  "mean": "<nghĩa đã chuẩn hóa>",
  "level": "${card.level}"
}`;
}

// ─── Gọi Gemini ──────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Không parse được JSON từ response: ${text.slice(0, 120)}`);
    return JSON.parse(match[0]);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLog(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

function printCard(original, improved) {
  console.log('\n' + '─'.repeat(56));
  console.log(`  Từ      : ${original.word}  (${original.level})`);
  console.log(`  Phonetic: ${original.phonetic}  →  ${improved.phonetic}`);
  console.log(`  Nghĩa   : ${original.mean}`);
  console.log(`          → ${improved.mean}`);
  console.log('─'.repeat(56));
}

// Ghi CARDS_FILE ngay lập tức từ allCards + results map hiện tại
function flushOutput(allCards, results) {
  const finalCards = allCards.map((card) =>
    results.has(card.id) ? results.get(card.id) : card
  );
  fs.writeFileSync(CARDS_FILE, JSON.stringify(finalCards, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== Cải thiện flashcard với Gemini ===\n');

  // Kiểm tra API key
  if (GEMINI_API_KEY === 'ĐIỀN_API_KEY_VÀO_ĐÂY' || !GEMINI_API_KEY) {
    console.error('Lỗi: Chưa có API key. Chạy lại với:\n  GEMINI_API_KEY=... node tools/improve-cards.js');
    rl.close();
    process.exit(1);
  }

  // Đọc cards.json
  const allCards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));

  const levels = [...new Set(allCards.map((c) => c.level))].sort();
  console.log(`Tổng số từ: ${allCards.length}`);
  console.log(`Các cấp độ hiện có: ${levels.join(', ')}\n`);

  // --- Hỏi trình độ ---
  const levelInput = await ask(rl, `Chọn cấp độ cần xử lý (${levels.join('/')}, hoặc "all"): `);
  const selectedLevels =
    levelInput.trim().toLowerCase() === 'all'
      ? levels
      : levelInput
          .toUpperCase()
          .split(/[,\s]+/)
          .filter((l) => levels.includes(l));

  if (!selectedLevels.length) {
    console.error('Không tìm thấy cấp độ hợp lệ.');
    rl.close();
    process.exit(1);
  }

  // Lọc các từ chưa được cải thiện (chưa có field "improved": true)
  const cards = allCards.filter(
    (c) => selectedLevels.includes(c.level) && !c.improved
  );
  const alreadyDone = allCards.filter(
    (c) => selectedLevels.includes(c.level) && c.improved
  ).length;

  console.log(`\nCấp: ${selectedLevels.join(', ')}`);
  if (alreadyDone > 0) {
    console.log(`Đã cải thiện trước đó: ${alreadyDone} từ (bỏ qua).`);
  }
  console.log(`Còn cần xử lý: ${cards.length} từ`);

  if (!cards.length) {
    console.log('Tất cả từ ở cấp độ này đã được xử lý!');
    rl.close();
    return;
  }

  // --- Hỏi chế độ ---
  const manualInput = await ask(rl, '\nDuyệt thủ công từng từ? (y/n): ');
  const manualMode = manualInput.trim().toLowerCase() === 'y';

  let ratePerSec = 1;
  if (!manualMode) {
    const rateInput = await ask(rl, 'Tốc độ xử lý (req/giây, mặc định 1): ');
    ratePerSec = parseFloat(rateInput) || 1;
    ratePerSec = Math.max(0.01, Math.min(ratePerSec, 10));
  }

  const confirm = await ask(rl, '\nBắt đầu? (y/n): ');
  if (confirm.trim().toLowerCase() !== 'y') {
    console.log('Hủy.');
    rl.close();
    return;
  }

  // --- Khởi tạo results map từ allCards (giữ lại những gì đã improved) ---
  const results = new Map();
  for (const card of allCards) {
    if (card.improved) results.set(card.id, card);
  }

  // --- Xử lý Ctrl+C: lưu trước khi thoát ---
  let exiting = false;
  process.on('SIGINT', () => {
    if (exiting) return;
    exiting = true;
    console.log('\n\nĐang lưu tiến độ trước khi thoát...');
    flushOutput(allCards, results);
    console.log(`Đã lưu ${results.size} từ vào ${CARDS_FILE}`);
    rl.close();
    process.exit(0);
  });

  // --- Vòng lặp chính ---
  let processed = 0;
  let skipped = 0;

  for (const card of cards) {
    if (exiting) break;

    console.log(`\n[${processed + skipped + 1}/${cards.length}] Đang xử lý: ${card.word} (${card.level})`);

    let improved = null;
    let attempt = 0;

    while (attempt < 3) {
      try {
        improved = await callGemini(buildPrompt(card));
        break;
      } catch (err) {
        attempt++;
        console.error(`  Lỗi (lần ${attempt}/3): ${err.message}`);
        if (attempt < 3) await sleep(2000);
      }
    }

    if (!improved) {
      appendLog({ id: card.id, word: card.word, status: 'error' });
      console.error(`\nDừng chương trình do lỗi liên tiếp 3 lần ở từ "${card.word}".`);
      console.error('Đang lưu tiến độ...');
      flushOutput(allCards, results);
      console.error(`Đã lưu. Chạy lại để tiếp tục từ chỗ dừng.`);
      rl.close();
      process.exit(1);
    }

    // Đảm bảo không bị thay đổi id/word/level, đánh dấu đã improved
    improved.id = card.id;
    improved.word = card.word;
    improved.level = card.level;
    improved.improved = true;

    printCard(card, improved);

    if (manualMode) {
      const action = await ask(rl, '  [a]pply / [s]kip / [e]dit phonetic / [m]edit mean ? (mặc định: a): ');
      const choice = action.trim().toLowerCase() || 'a';

      if (choice === 's') {
        console.log('  → Bỏ qua.');
        appendLog({ id: card.id, word: card.word, status: 'skipped' });
        skipped++;
        continue;
      }

      if (choice === 'e') {
        const newPhonetic = await ask(rl, `  Phonetic mới (hiện tại: ${improved.phonetic}): `);
        if (newPhonetic.trim()) improved.phonetic = newPhonetic.trim();
      }

      if (choice === 'm') {
        const newMean = await ask(rl, `  Nghĩa mới (hiện tại: ${improved.mean}): `);
        if (newMean.trim()) improved.mean = newMean.trim();
      }

      if (choice === 'e' || choice === 'm') {
        printCard(card, improved);
        const confirm2 = await ask(rl, '  Xác nhận lưu? (y/n, mặc định: y): ');
        if (confirm2.trim().toLowerCase() === 'n') {
          appendLog({ id: card.id, word: card.word, status: 'skipped' });
          skipped++;
          continue;
        }
      }
    }

    // Lưu vào map và ghi file ngay lập tức
    results.set(card.id, improved);
    appendLog({ id: card.id, word: card.word, status: 'ok' });
    flushOutput(allCards, results);
    processed++;

    if (!manualMode) {
      await sleep(Math.round(1000 / ratePerSec));
    }
  }

  // --- Hoàn thành ---
  console.log('\n' + '═'.repeat(56));
  console.log('Hoàn thành!');
  console.log(`  Đã cải thiện : ${processed} từ`);
  console.log(`  Bỏ qua       : ${skipped} từ`);
  console.log(`  File kết quả : data/cards.json`);
  console.log('');
  console.log('  (Dùng normalize-cards.js để dọn field "improved" khi cần)');
  console.log('═'.repeat(56));

  rl.close();
}

main().catch((err) => {
  console.error('Lỗi không xử lý được:', err);
  process.exit(1);
});
