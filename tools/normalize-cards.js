const fs = require('fs');
const CARDS_FILE = 'data/cards.json';

const raw = fs.readFileSync(CARDS_FILE, 'utf8');
const parsed = JSON.parse(raw);

const normalized = parsed.map((card, index) => {
  const word = String(card.word || '').trim();
  const phonetic = String(card.phonetic || '').trim();
  const mean = String(card.mean || '').trim();
  const level = String(card.level || 'N5').trim().toUpperCase() || 'N5';

  const wordSlug = word.toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'word';

  const id = String(card.id || '').trim() || `card-${wordSlug}-${level}-${index}`;

  return {
    id,
    word,
    phonetic,
    mean,
    level
  };
});

fs.writeFileSync(CARDS_FILE, JSON.stringify(normalized, null, 2));
console.log(`normalized ${normalized.length} cards`);
