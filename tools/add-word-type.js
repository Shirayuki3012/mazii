/**
 * add-word-type.js
 * Dùng Gemini API để tự động phân loại từ cho flashcard.
 *
 * Cách dùng:
 *   node tools/add-word-type.js
 *
 * Tuỳ chọn:
 *   node tools/add-word-type.js --level N5       # chỉ xử lý cấp độ nhất định
 *   node tools/add-word-type.js --level N5,N4    # nhiều cấp độ
 *   node tools/add-word-type.js --all             # xử lý lại cả từ đã có loại từ
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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const CARDS_FILE = path.join(__dirname, '..', 'data', 'cards.json');

// Các loại từ hợp lệ
const VALID_TYPES = [
  'trạng từ',
  'tính từ',
  'danh từ',
  'danh từ suru',
  'tự động từ',
  'tha động từ',
  'phó từ',
];

// Số từ gửi Gemini trong một request (batch)
const BATCH_SIZE = 20;

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(cards) {
  const list = cards
    .map((c, i) => `${i + 1}. id="${c.id}" word="${c.word}" phonetic="${c.phonetic}" mean="${c.mean}" level="${c.level}"`)
    .join('\n');

  return `Bạn là chuyên gia tiếng Nhật. Hãy phân loại từ loại cho các từ vựng tiếng Nhật sau đây.

Danh sách từ:
${list}

Quy tắc phân loại:
- "trạng từ": tính từ đuôi な hoặc い dùng làm trạng từ (副詞)... thực ra đây là 副詞, ví dụ: もっと, ずっと, やっぱり
- "tính từ": い-adjective (形容詞) hoặc な-adjective (形容動詞), ví dụ: 大きい, 静か
- "danh từ": danh từ thuần túy (名詞) không kết hợp với する, ví dụ: 本, 学校
- "danh từ suru": danh từ có thể + する để thành động từ (サ変名詞), ví dụ: 勉強, 運動
- "tự động từ": động từ tự động (自動詞) — hành động không tác động lên tân ngữ, ví dụ: 起きる, 走る
- "tha động từ": động từ tha động (他動詞) — hành động tác động lên tân ngữ, ví dụ: 食べる, 読む
- "phó từ": phó từ (副詞) đứng trước động từ/tính từ bổ nghĩa, ví dụ: とても, だいたい

Lưu ý:
- Nếu một từ vừa là tự động từ vừa là tha động từ, chọn loại từ chính yếu hơn.
- Với từ katakana ngoại lai, phân loại dựa trên nghĩa và cách dùng.
- Chỉ trả về JSON, không giải thích thêm.

Trả về JSON array theo đúng cấu trúc sau:
[
  { "id": "<id>", "wordType": "<loại từ>" },
  ...
]

Chỉ dùng các giá trị wordType sau (viết chính xác): ${VALID_TYPES.map(t => `"${t}"`).join(', ')}`;
}

// ─── Gọi Gemini ──────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
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
    // Cố extract JSON array từ response
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`Không parse được JSON từ response: ${text.slice(0, 200)}`);
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

function flushCards(cards) {
  fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { levels: null, all: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--level' && args[i + 1]) {
      result.levels = args[i + 1].toUpperCase().split(',').map((l) => l.trim());
      i++;
    } else if (args[i] === '--all') {
      result.all = true;
    }
  }
  return result;
}

// Chia mảng thành các batch nhỏ
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== Thêm loại từ bằng Gemini ===\n');

  // Kiểm tra API key
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'ĐIỀN_API_KEY_VÀO_ĐÂY') {
    console.error('Lỗi: Chưa có GEMINI_API_KEY trong .env');
    rl.close();
    process.exit(1);
  }

  const opts = parseArgs();

  // Đọc cards
  const allCards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));

  const levels = [...new Set(allCards.map((c) => c.level))].sort();
  console.log(`Tổng số từ: ${allCards.length}`);
  console.log(`Các cấp độ: ${levels.join(', ')}`);
  console.log(`Model: ${GEMINI_MODEL}\n`);

  // Lọc theo level nếu truyền qua arg, ngược lại hỏi
  let selectedLevels;
  if (opts.levels && opts.levels.length) {
    selectedLevels = opts.levels.filter((l) => levels.includes(l));
    if (!selectedLevels.length) {
      console.error('Không tìm thấy cấp độ hợp lệ.');
      rl.close();
      process.exit(1);
    }
    console.log(`Cấp độ (từ --level): ${selectedLevels.join(', ')}`);
  } else {
    const levelInput = await ask(rl, `Chọn cấp độ cần xử lý (${levels.join('/')}, hoặc "all"): `);
    selectedLevels =
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
  }

  // Lọc pool theo level
  let pool = allCards.filter((c) => selectedLevels.includes(c.level));

  // Lọc từ chưa có wordType (trừ khi --all)
  let cards;
  if (opts.all) {
    cards = pool;
    console.log(`\nChế độ --all: xử lý lại ${cards.length} từ.`);
  } else {
    const alreadyDone = pool.filter((c) => c.wordType).length;
    cards = pool.filter((c) => !c.wordType);
    if (alreadyDone > 0) {
      console.log(`\nĐã có loại từ: ${alreadyDone} từ (bỏ qua).`);
    }
    console.log(`Cần xử lý: ${cards.length} từ`);
  }

  if (!cards.length) {
    console.log('Không có từ nào cần xử lý. Thoát.');
    rl.close();
    return;
  }

  // Hỏi tốc độ
  const rateInput = await ask(rl, `\nTốc độ xử lý (req/giây, mặc định 1, mỗi batch ~${BATCH_SIZE} từ): `);
  const ratePerSec = Math.max(0.1, Math.min(parseFloat(rateInput) || 1, 10));
  const delayMs = Math.round(1000 / ratePerSec);

  const batches = chunk(cards, BATCH_SIZE);
  console.log(`\nSẽ gửi ${batches.length} batch (${BATCH_SIZE} từ/batch) với delay ${delayMs}ms.\n`);

  const confirm = await ask(rl, 'Bắt đầu? (y/n): ');
  if (confirm.trim().toLowerCase() !== 'y') {
    console.log('Đã hủy.');
    rl.close();
    return;
  }

  // Xử lý Ctrl+C
  let exiting = false;
  process.on('SIGINT', () => {
    if (exiting) return;
    exiting = true;
    console.log('\n\nĐang lưu tiến độ...');
    flushCards(allCards);
    console.log(`Đã lưu vào ${CARDS_FILE}`);
    rl.close();
    process.exit(0);
  });

  let processed = 0;
  let failed = 0;

  for (let bi = 0; bi < batches.length; bi++) {
    if (exiting) break;

    const batch = batches[bi];
    const from = bi * BATCH_SIZE + 1;
    const to = Math.min(from + batch.length - 1, cards.length);
    process.stdout.write(`Batch ${bi + 1}/${batches.length} (từ ${from}–${to})... `);

    let result = null;
    let attempt = 0;

    while (attempt < 3) {
      try {
        result = await callGemini(buildPrompt(batch));
        break;
      } catch (err) {
        attempt++;
        process.stdout.write(`\n  Lỗi (lần ${attempt}/3): ${err.message}\n`);
        if (attempt < 3) await sleep(2000);
      }
    }

    if (!result) {
      console.log(`THẤT BẠI — bỏ qua batch này.`);
      failed += batch.length;
      continue;
    }

    // Map kết quả vào allCards
    let batchOk = 0;
    for (const item of result) {
      if (!item.id || !item.wordType) continue;
      if (!VALID_TYPES.includes(item.wordType)) {
        // Gemini trả về giá trị không hợp lệ — bỏ qua
        continue;
      }

      const cardRef = allCards.find((c) => c.id === item.id);
      if (cardRef) {
        cardRef.wordType = item.wordType;
        batchOk++;
      }
    }

    // Ghi file ngay sau mỗi batch
    flushCards(allCards);
    processed += batchOk;
    console.log(`✓ ${batchOk}/${batch.length} từ đã phân loại`);

    // In chi tiết từng từ trong batch
    for (const item of result) {
      const c = batch.find((x) => x.id === item.id);
      if (c) {
        console.log(`  ${c.word.padEnd(8)} ${c.phonetic.padEnd(16)} → ${item.wordType || '(không xác định)'}`);
      }
    }

    if (bi < batches.length - 1) {
      await sleep(delayMs);
    }
  }

  // Tổng kết
  console.log('\n' + '═'.repeat(56));
  console.log('Hoàn thành!');
  console.log(`  Đã phân loại : ${processed} từ`);
  if (failed > 0) {
    console.log(`  Thất bại      : ${failed} từ (chạy lại để retry)`);
  }
  console.log(`  File kết quả  : data/cards.json`);
  console.log('═'.repeat(56));

  rl.close();
}

main().catch((err) => {
  console.error('Lỗi không xử lý được:', err);
  process.exit(1);
});
