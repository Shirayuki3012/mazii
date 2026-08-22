/**
 * build-kanji-cache.js
 * Dùng Gemini để tìm các kanji trông giống nhau về hình dạng và ghi vào cache.json.
 * Chỉ xử lý các kanji chưa có trong cache (incremental).
 *
 * Cách dùng:
 *   node tools/build-kanji-cache.js
 *   node tools/build-kanji-cache.js --all     # xử lý lại toàn bộ (ghi đè)
 *
 * Biến môi trường:
 *   GEMINI_API_KEY  — API key của Gemini (bắt buộc)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load .env thủ công
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

const KANJI_FILE = path.join(__dirname, '..', 'data', 'kanji.json');
const CACHE_FILE = path.join(__dirname, '..', 'data', 'cache.json');

// Số kanji gửi Gemini trong một request
const BATCH_SIZE = 30;

// Delay giữa các batch (ms)
const DELAY_MS = 1200;

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(kanjiList, allKanji) {
  const targets = kanjiList.join(' ');
  // Chỉ gửi 200 kanji đầu làm pool tham chiếu để tránh prompt quá dài
  const pool = allKanji.slice(0, 200).join('');

  return `Bạn là chuyên gia về chữ Hán (Kanji). Với mỗi kanji trong danh sách TARGET, hãy tìm các kanji trong danh sách POOL trông GIỐNG NHAU VỀ HÌNH DẠNG (visual similarity) — tức là dễ nhầm lẫn khi học, ví dụ: 土 vs 士, 末 vs 未, 己 vs 已 vs 巳, 大 vs 犬, v.v.

TARGET: ${targets}
POOL: ${pool}

Tiêu chí:
- Chỉ xét sự giống nhau về MẶT HÌNH DẠNG (visual), không phải nghĩa hay âm đọc
- Ngưỡng: chỉ liệt kê kanji mà người học thực sự có thể nhầm lẫn (giống >= 70%)
- Mỗi kanji target có thể có 0 đến nhiều kanji giống
- Kanji trong kết quả PHẢI là ký tự đơn (1 character)

Trả về JSON object, key là kanji target, value là array các kanji giống (chỉ ký tự, không cần score):
{
  "土": ["士", "工"],
  "末": ["未", "木"],
  "後": []
}

Chỉ trả JSON, không giải thích. Đảm bảo tất cả ${kanjiList.length} kanji trong TARGET đều có key trong kết quả.`;
}

// ─── Gọi Gemini ──────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
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
    throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Không parse được JSON: ${text.slice(0, 200)}`);
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

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseArgs() {
  return { all: process.argv.includes('--all') };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== Build kanji similarity cache (Gemini) ===\n');

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'ĐIỀN_API_KEY_VÀO_ĐÂY') {
    console.error('Lỗi: Chưa có GEMINI_API_KEY trong .env');
    rl.close();
    process.exit(1);
  }

  if (!fs.existsSync(KANJI_FILE)) {
    console.error(`Lỗi: Không tìm thấy ${KANJI_FILE}`);
    console.error('Chạy trước: node tools/extract-kanji.js');
    rl.close();
    process.exit(1);
  }

  const opts = parseArgs();

  // Đọc danh sách kanji
  const allKanji = JSON.parse(fs.readFileSync(KANJI_FILE, 'utf8'));
  // Lọc chỉ lấy kanji thực sự (Unicode CJK block)
  const kanjiOnly = allKanji.filter((ch) => {
    const code = ch.codePointAt(0);
    return (
      (code >= 0x4e00 && code <= 0x9fff) ||   // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) ||   // Extension A
      (code >= 0xf900 && code <= 0xfaff)       // CJK Compatibility Ideographs
    );
  });

  console.log(`Kanji trong kanji.json: ${allKanji.length} ký tự`);
  console.log(`Sau lọc (chỉ CJK): ${kanjiOnly.length} kanji`);
  console.log(`Model: ${GEMINI_MODEL}`);

  const cache = loadCache();
  console.log(`Cache hiện tại: ${Object.keys(cache).length} entries\n`);

  // Xác định danh sách cần xử lý
  let targets;
  if (opts.all) {
    targets = kanjiOnly;
    console.log(`Chế độ --all: xử lý lại toàn bộ ${targets.length} kanji.`);
  } else {
    targets = kanjiOnly.filter((ch) => !(ch in cache));
    const done = kanjiOnly.length - targets.length;
    if (done > 0) console.log(`Đã có trong cache: ${done} kanji (bỏ qua).`);
    console.log(`Cần xử lý: ${targets.length} kanji`);
  }

  if (!targets.length) {
    console.log('\nKhông có kanji nào cần xử lý. Thoát.');
    rl.close();
    return;
  }

  const batches = chunk(targets, BATCH_SIZE);
  console.log(`Sẽ gửi ${batches.length} batch (${BATCH_SIZE} kanji/batch).\n`);

  const confirm = await ask(rl, 'Bắt đầu? (y/n): ');
  if (confirm.trim().toLowerCase() !== 'y') {
    console.log('Đã hủy.');
    rl.close();
    return;
  }

  // Ctrl+C handler
  let exiting = false;
  process.on('SIGINT', () => {
    if (exiting) return;
    exiting = true;
    console.log('\n\nĐang lưu cache...');
    saveCache(cache);
    console.log(`Đã lưu ${Object.keys(cache).length} entries vào cache.json`);
    rl.close();
    process.exit(0);
  });

  let processed = 0;
  let failed = 0;

  for (let bi = 0; bi < batches.length; bi++) {
    if (exiting) break;

    const batch = batches[bi];
    const from = bi * BATCH_SIZE + 1;
    const to = Math.min(from + batch.length - 1, targets.length);
    process.stdout.write(`Batch ${bi + 1}/${batches.length} (${from}–${to})... `);

    let result = null;
    let attempt = 0;

    while (attempt < 3) {
      try {
        result = await callGemini(buildPrompt(batch, kanjiOnly));
        break;
      } catch (err) {
        attempt++;
        process.stdout.write(`\n  Lỗi lần ${attempt}/3: ${err.message}\n`);
        if (attempt < 3) await sleep(3000);
      }
    }

    if (!result) {
      console.log('THẤT BẠI — bỏ qua batch.');
      failed += batch.length;
      continue;
    }

    // Ghi vào cache — value là array [{kanji, score}] để tương thích với format cũ
    let batchOk = 0;
    for (const ch of batch) {
      const raw = result[ch];
      if (!Array.isArray(raw)) continue;

      // Lọc và chuẩn hoá: chỉ giữ ký tự đơn hợp lệ, loại bỏ chính nó
      const similar = raw
        .filter((item) => {
          const k = typeof item === 'string' ? item : item?.kanji;
          return k && k.length === 1 && k !== ch;
        })
        .map((item) => {
          const k = typeof item === 'string' ? item : item.kanji;
          const s = typeof item === 'object' && typeof item.score === 'number'
            ? item.score
            : 0.85; // default score khi Gemini chỉ trả string
          return { kanji: k, score: parseFloat(s.toFixed(4)) };
        });

      cache[ch] = similar;
      batchOk++;
    }

    saveCache(cache);
    processed += batchOk;
    console.log(`✓ ${batchOk}/${batch.length} kanji`);

    // In chi tiết
    for (const ch of batch) {
      const entry = cache[ch];
      if (!entry) continue;
      const similar = entry.map((x) => x.kanji).join(' ') || '(không có)';
      console.log(`  ${ch}  →  ${similar}`);
    }

    if (bi < batches.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Tổng kết
  console.log('\n' + '═'.repeat(56));
  console.log('Hoàn thành!');
  console.log(`  Đã xử lý  : ${processed} kanji`);
  if (failed > 0) console.log(`  Thất bại  : ${failed} kanji (chạy lại để retry)`);
  console.log(`  Cache tổng: ${Object.keys(cache).length} entries`);
  console.log(`  File       : data/cache.json`);
  console.log('═'.repeat(56));

  rl.close();
}

main().catch((err) => {
  console.error('Lỗi:', err);
  process.exit(1);
});
