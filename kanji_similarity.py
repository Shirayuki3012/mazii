import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import transforms
from PIL import Image, ImageDraw, ImageFont
import json, os, random

from tqdm import tqdm

KANJI_FILE = "data/kanji.json"
SIM_FILE = "data/similar.json"
DIS_FILE = "data/dissimilar.json"
MODEL_FILE = "kanji_autoencoder.pt"

# Autoencoder cho Kanji
class KanjiAutoencoder(nn.Module):
    def __init__(self, embedding_dim=128):
        super().__init__()
        # Encoder
        self.encoder = nn.Sequential(
            nn.Conv2d(1, 32, 3, stride=2, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.Conv2d(32, 64, 3, stride=2, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
            nn.Conv2d(64, 128, 3, stride=2, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
            nn.Conv2d(128, 256, 3, stride=2, padding=1), nn.BatchNorm2d(256), nn.ReLU()
        )
        self.fc1 = nn.Linear(256*8*8, embedding_dim)

        # Decoder
        self.fc2 = nn.Linear(embedding_dim, 256*8*8)
        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(256, 128, 3, stride=2, padding=1, output_padding=1), nn.BatchNorm2d(128), nn.ReLU(),
            nn.ConvTranspose2d(128, 64, 3, stride=2, padding=1, output_padding=1), nn.BatchNorm2d(64), nn.ReLU(),
            nn.ConvTranspose2d(64, 32, 3, stride=2, padding=1, output_padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.ConvTranspose2d(32, 1, 3, stride=2, padding=1, output_padding=1), nn.Sigmoid()
        )

    def forward(self, x):
        x = self.encoder(x)
        x = x.view(x.size(0), -1)
        z = self.fc1(x)
        x = self.fc2(z)
        x = x.view(x.size(0), 256, 8, 8)
        x = self.decoder(x)
        return x, z

def render_kanji(ch, size=128):
    # Dùng font hỗ trợ Unicode (ví dụ DejaVuSans hoặc NotoSansCJK)
    font_path = r"C:\Windows\Fonts\msgothic.ttc"  # ví dụ MS Gothic
    font = ImageFont.truetype(font_path, 100)

    img = Image.new("L", (size, size), 255)
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), ch, font=font, fill=0)

    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.5,), (0.5,))
    ])
    return transform(img).unsqueeze(0).to("cuda" if torch.cuda.is_available() else "cpu")

# Load/lưu JSON
def load_json(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# Tiền huấn luyện autoencoder
def pretrain_autoencoder(model, kanji_list, epochs=15, lr_start=1e-3, lr_end=1e-5):
    optimizer = optim.Adam(model.parameters(), lr=lr_start)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=lr_end)
    criterion = nn.MSELoss()
    for epoch in range(epochs):
        total_loss = 0
        pbar = tqdm(kanji_list, desc=f"Epoch {epoch+1}/{epochs}")
        for ch in pbar:
            x = render_kanji(ch)
            recon, _ = model(x)
            loss = criterion(recon, x)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            pbar.set_postfix(loss=total_loss/(pbar.n + 1), lr=scheduler.get_last_lr()[0])
        print(f"Epoch {epoch+1}/{epochs}, loss={total_loss/len(kanji_list):.4f}")
        scheduler.step()

    # chọn ngẫu nhiên 1 chữ để kiểm tra kết quả
    index = random.randint(0, len(kanji_list)-1)
    recon, _ = model(render_kanji(kanji_list[index]))
    recon_img = recon.squeeze(0).squeeze(0).detach().cpu().numpy()
    
    recon_img = (recon_img * 0.5 + 0.5) * 255
    recon_img = Image.fromarray(recon_img.astype('uint8'))
    recon_img.show()

def train_from_json(model, optimizer, sim_map, dis_map, epochs=5):
    for epoch in range(epochs):
        total_loss = 0
        for key, score in tqdm(sim_map.items(), desc=f"Epoch {epoch+1}/{epochs} (positive)"):
            a, b = key.split("-")
            _, va = model(render_kanji(a))
            _, vb = model(render_kanji(b))
            # positive pair
            loss = 1 - torch.cosine_similarity(va, vb, dim=1)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        for key, score in tqdm(dis_map.items(), desc=f"Epoch {epoch+1}/{epochs} (negative)"):
            a, b = key.split("-")
            _, va = model(render_kanji(a))
            _, vb = model(render_kanji(b))
            # negative pair
            loss = torch.cosine_similarity(va, vb, dim=1)
            if loss.item() > 0:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
        print(f"Epoch {epoch+1}, loss={total_loss:.4f}")
    # đánh giá độ chính xác trên tập huấn luyện, ngưỡng trên 0.8, ngưỡng dưới 0.2, các kết quả 0.2-0.8 -> sai
    correct = 0
    for key, score in sim_map.items():
        a, b = key.split("-")
        _, va = model(render_kanji(a))
        _, vb = model(render_kanji(b))
        # positive pair
        correct += torch.cosine_similarity(va, vb, dim=1).item() >= 0.8
    for key, score in dis_map.items():
        a, b = key.split("-")
        _, va = model(render_kanji(a))
        _, vb = model(render_kanji(b))
        # negative pair
        correct += torch.cosine_similarity(va, vb, dim=1).item() <= 0.2
    print("Độ chính xác trên tập huấn luyện: {:.2f}%".format(correct / (len(sim_map) + len(dis_map)) * 100))
    torch.save(model.state_dict(), MODEL_FILE)
    print("Đã lưu mô hình vào", MODEL_FILE)

def build_similarity_matrix(model, kanji_list):
    embeddings = {}
    for ch in kanji_list:
        _, z = model(render_kanji(ch))
        embeddings[ch] = z.detach()
    pairs = []
    for i, a in tqdm(enumerate(kanji_list), desc="Building similarity matrix"):
        for j, b in enumerate(kanji_list):
            if i < j:
                score = torch.cosine_similarity(embeddings[a], embeddings[b], dim=1).item()
                pairs.append((a, b, score))
    return pairs

def sample_pairs(pairs):
    # sort theo score
    pairs_sorted = sorted(pairs, key=lambda x: x[2])
    
    # 32 cặp có score cao nhất
    top_samples = [p for p in pairs_sorted if p[2] >= 0.8]
    top = random.sample(top_samples, min(32, len(top_samples)))

    # 16 cặp gần 0.5
    middle_samples = [p for p in pairs_sorted if abs(p[2]-0.5) < 0.3]
    middle = random.sample(middle_samples, min(16, len(middle_samples)))
    
    # 8 cặp gần 0 
    low_samples = [p for p in pairs_sorted if abs(p[2]) < 0.2]
    low = random.sample(low_samples, min(8, len(low_samples)))
    
    # 8 cặp score âm
    neg_samples = [p for p in pairs_sorted if p[2] <= -0.2]
    neg = random.sample(neg_samples, min(8, len(neg_samples)))
    
    return top + middle + low + neg

def interactive_epoch(model, kanji_list, sim_map, dis_map):
    pairs = build_similarity_matrix(model, kanji_list)
    selected = sample_pairs(pairs)
    for a, b, score in selected:
        key = f"{a}-{b}"
        ukey = f"{b}-{a}"
        if key in sim_map or key in dis_map or ukey in sim_map or ukey in dis_map:
            continue
        print(f"{a} vs {b}, similarity={score:.2f}")
        ans = input("Giống nhau? (y/n/q): ").strip().lower()
        if ans == "q": break
        if score < 0.2 and ans=="n":
            # mô hình đã đúng, không cần cập nhật
            dis_map[key] = score
            continue
        if ans=="y": sim_map[key] = score
        else: dis_map[key] = score

    # Lưu kết quả
    save_json(SIM_FILE, sim_map)
    save_json(DIS_FILE, dis_map)
    print("Đã lưu dữ liệu.")

# Main
def main():
    kanji_list = json.load(open(KANJI_FILE, "r", encoding="utf-8"))
    sim_map = load_json(SIM_FILE)
    dis_map = load_json(DIS_FILE)

    model = KanjiAutoencoder().to("cuda" if torch.cuda.is_available() else "cpu")
    optimizer = optim.Adam(model.parameters(), lr=1e-4)

    # Nếu có mô hình đã lưu thì load lại
    if os.path.exists(MODEL_FILE):
        model.load_state_dict(torch.load(MODEL_FILE))
        print("Đã load mô hình cũ.")
    else:
        print("Tiền huấn luyện autoencoder...")
        pretrain_autoencoder(model, kanji_list, epochs=15)

    if len(sim_map) > 0 and len(dis_map) > 0:
        train_from_json(model, optimizer, sim_map, dis_map, epochs=10)
    interactive_epoch(model, kanji_list, sim_map, dis_map)
    

if __name__ == "__main__":
    main()
