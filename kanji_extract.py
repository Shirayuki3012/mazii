# Đọc từng từ trong cards.json, loại bỏ hiragana và katakana, và lưu các kanji duy nhất vào kanji.json

import json
import os
from tqdm import tqdm

CARD_FILE = "data/cards.json"
KANJI_FILE = "data/kanji.json"

# Load cards
cards = json.load(open(CARD_FILE, "r", encoding="utf-8"))

# Load dữ liệu có sẵn
kanji_list = json.load(open(KANJI_FILE, "r", encoding="utf-8")) if os.path.exists(KANJI_FILE) else []

# Mẫu hiragana
hiragana = set("ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ")
# Mẫu katakana
katakana = set("ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶー")

for card in tqdm(cards, desc="Đang xử lý cards.json"):
    word = card.get("word", "")
    # loại bỏ hiragana và katakana
    for char in word:
        if char not in hiragana and char not in katakana and char not in kanji_list:
            kanji_list.append(char)

# Lưu danh sách kanji vào file
with open(KANJI_FILE, "w", encoding="utf-8") as f:
    json.dump(kanji_list, f, ensure_ascii=False)
