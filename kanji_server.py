import json
import os
import random
import threading
from pathlib import Path

from flask import Flask, jsonify, request

# Thử import các thư viện AI — nếu thiếu thì chạy chế độ cache-only
AI_AVAILABLE = False
_ai_import_error = None

try:
    import torch
    from kanji_similarity import KANJI_FILE, MODEL_FILE, KanjiAutoencoder, render_kanji
    AI_AVAILABLE = True
except ImportError as e:
    _ai_import_error = str(e)

BASE_DIR = Path(__file__).resolve().parent
CACHE_FILE = "data/cache.json"
PORT = int(os.environ.get("KANJI_SERVER_PORT", 3001))
SIMILARITY_THRESHOLD = 0.8
DEFAULT_COUNT = 3

app = Flask(__name__)
cache_lock = threading.Lock()

# Chỉ dùng khi AI_AVAILABLE
if AI_AVAILABLE:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

model = None
kanji_list = []
embeddings = {}
similarity_cache = {}


def load_cache():
    global similarity_cache

    cache_path = BASE_DIR / CACHE_FILE
    if not cache_path.exists():
        similarity_cache = {}
        return

    with open(cache_path, "r", encoding="utf-8") as f:
        similarity_cache = json.load(f)


def save_cache():
    cache_path = BASE_DIR / CACHE_FILE
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(similarity_cache, f, ensure_ascii=False, indent=2)


def load_resources():
    """Load model và tính embeddings — chỉ gọi khi AI_AVAILABLE."""
    global model, kanji_list, embeddings

    kanji_path = BASE_DIR / KANJI_FILE
    model_path = BASE_DIR / MODEL_FILE

    with open(kanji_path, "r", encoding="utf-8") as f:
        kanji_list = json.load(f)

    model = KanjiAutoencoder().to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    with torch.no_grad():
        for ch in kanji_list:
            ch = ch.strip()
            if not ch:
                continue
            _, z = model(render_kanji(ch))
            embeddings[ch] = z.detach()


def ensure_embedding(query: str):
    if query in embeddings:
        return

    with torch.no_grad():
        _, z = model(render_kanji(query))
        embeddings[query] = z.detach()


def compute_all_similar(query: str):
    query = query.strip()
    if not query:
        return []

    ensure_embedding(query)
    query_vec = embeddings[query]
    matches = []

    for ch, vec in embeddings.items():
        if ch == query:
            continue
        score = torch.cosine_similarity(query_vec, vec, dim=1).item()
        if score > SIMILARITY_THRESHOLD:
            matches.append({"kanji": ch, "score": round(score, 4)})

    return matches


def get_all_similar(query: str):
    """Trả về tất cả kanji giống query. Ưu tiên cache, nếu không có thì tính (chỉ khi AI_AVAILABLE)."""
    query = query.strip()
    if not query:
        return []

    with cache_lock:
        if query in similarity_cache:
            return similarity_cache[query]

    if not AI_AVAILABLE:
        # Cache-only mode: không có entry -> trả về rỗng, không tính mới được
        return []

    matches = compute_all_similar(query)

    with cache_lock:
        similarity_cache[query] = matches
        save_cache()

    return matches


def find_similar_kanji(query: str, count: int = DEFAULT_COUNT):
    all_matches = get_all_similar(query)
    if not all_matches:
        return []

    sample_size = min(count, len(all_matches))
    if sample_size == 0:
        return []

    return random.sample(all_matches, sample_size)


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "mode": "ai" if AI_AVAILABLE else "cache-only",
        "kanji_count": len(embeddings),
        "cache_count": len(similarity_cache),
    })


@app.post("/api/similar")
def similar_kanji():
    payload = request.get_json(silent=True) or {}
    query = payload.get("kanji") or request.args.get("kanji", "")
    count = payload.get("count", request.args.get("count", DEFAULT_COUNT))

    try:
        count = int(count)
    except (TypeError, ValueError):
        count = DEFAULT_COUNT

    count = max(0, count)

    if not query or not str(query).strip():
        return jsonify({"message": "Thiếu tham số kanji."}), 400

    query = str(query).strip()
    if len(query) != 1:
        return jsonify({"message": "Kanji phải là một ký tự."}), 400

    with cache_lock:
        was_cached = query in similarity_cache

    results = find_similar_kanji(query, count)
    return jsonify(
        {
            "kanji": query,
            "count": len(results),
            "similar": results,
            "cached": was_cached,
            "mode": "ai" if AI_AVAILABLE else "cache-only",
        }
    )


if __name__ == "__main__":
    load_cache()

    if AI_AVAILABLE:
        print("Chế độ: AI (torch + model)")
        print("Loading model, cache and kanji data...")
        load_resources()
        print(f"Đã load {len(embeddings)} embeddings kanji")
    else:
        print(f"Chế độ: cache-only (lý do: {_ai_import_error})")
        print("Chỉ dùng dữ liệu cache có sẵn, không tính similarity mới.")

    print(f"Kanji similarity server running at http://localhost:{PORT}")
    print(f"Loaded {len(similarity_cache)} cached kanji entries")
    app.run(host="0.0.0.0", port=PORT, debug=True)
