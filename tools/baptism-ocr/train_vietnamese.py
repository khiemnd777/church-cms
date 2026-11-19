"""Train and export the local Paddle cell recognizer from generated text and OFL fonts."""

import argparse
import hashlib
import json
import random
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import cv2
import numpy as np
import paddle
from paddle import nn
from PIL import Image, ImageDraw, ImageFont

from vietnamese import ACCENTED, ALPHABET, HEIGHT, WIDTH, decode, prepare


SEED = 741042
LABELS = {character: index + 1 for index, character in enumerate(ALPHABET)}
WORDS = (
    'Hứa Bùi Lương Tống Trịnh Hồ Đinh Lâm Lưu Dương Chu Tạ Bành Cao Đoàn Ninh Phùng '
    'Thuận Quỳnh Phượng Vũ Dũng Khang Diệp Huyền Việt Thúy Khánh Tuệ Kiều Bửu Châu Thảo '
    'Tuyết Phước Nghĩa Uyển Bách Linh Lợi Thiện Phúc Ái Thủy Quảng Thừa Vĩnh Thái Duyên '
    'Hiền Bình Cường Lộc Thọ Nhựt Tuyền Yến Yên Thành Hậu Chánh Hữu Xuân Hùng Diễm Mẫn '
    'Cần Thơ Bạc Liêu Sóc Trăng Bình Thuận Hà Tiên Lạng Sơn Sài Gòn Cà Mau Tuyên Quang '
    'Phủ Dầu Giây Bến Lức Cửa Lò Bảo Lộc Móng Cái Sóc Sơn Đắk Nông Tiền Giang Long An '
    'Nghệ Tĩnh Vũng Tàu Mỹ Tho Hậu Giang Phố Núi Kiên Lương Phú Quốc Quế Sơn Hà Nội'
).split()
SYLLABLES = (
    'Hà Hả Hã Hạ Há Hò Họ Hố Hổ Hồ Hỡ Hở Hợ Hớ Hờ Hứa Hừ Hử Hữ Hự '
    'Bến Biển Biến Biện Bền Bển Bệ Bắc Bạc Bậc Bằng Bẵng Bảng Bạng Bảo Bảo '
    'Khải Khái Khại Khãi Quế Quệ Quễ Quề Trứ Trừ Trụ Trú Trù Trụ Đài Đãi Đại '
    'Ấn Ần Ẩn Ận Ân Ứng Ừng Ửng Ững Ựng Ỵ Ỷ Ỹ Ỳ ở ớ ờ ợ ỡ'
).split()


class Recognition(nn.Layer):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2D(1, 12, 3, stride=2, padding=1), nn.BatchNorm2D(12), nn.ReLU(),
            nn.Conv2D(12, 24, 3, stride=2, padding=1), nn.BatchNorm2D(24), nn.ReLU(),
            nn.Conv2D(24, 40, 3, stride=(2, 1), padding=1), nn.BatchNorm2D(40), nn.ReLU(),
            nn.Conv2D(40, 56, (4, 3), padding=(0, 1)), nn.BatchNorm2D(56), nn.ReLU(),
        )
        self.context = nn.Sequential(
            nn.Conv1D(56, 80, 5, padding=2), nn.BatchNorm1D(80), nn.ReLU(),
            nn.Conv1D(80, 56, 5, padding=2), nn.BatchNorm1D(56),
        )
        self.classifier = nn.Linear(56, len(ALPHABET) + 1)

    def forward(self, x):
        sequence = self.features(x).squeeze(2)
        return self.classifier(nn.functional.relu(sequence + self.context(sequence)).transpose([0, 2, 1]))


def example_text(rng):
    sample = rng.random()
    if sample < .15:
        d, m, y = rng.randint(1, 29), rng.randint(1, 12), rng.randint(1930, 2026)
        if sample < .023:
            return f'ngày {d} tháng {m} năm {y}'
        sep = rng.choice('/-.')
        return sep.join((f'{d:02d}', f'{m:02d}', str(y))) if sample > .038 else f'{d}/{m}/…'
    if sample < .22:
        return rng.choice(('Họ tên', 'Ngày', 'Nơi', 'Người cử hành', 'Báp-têm'))
    if sample < .33:
        chars = ACCENTED + ACCENTED.upper() + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
        return ' '.join(''.join(rng.choices(chars, k=rng.randint(1, 4))) for _ in range(rng.randint(1, 3)))
    text = ' '.join(rng.choices(WORDS + SYLLABLES if sample < .55 else WORDS, k=rng.randint(1, 4)))
    return text.upper() if sample < .43 else text


def render(text, font, rng, noise):
    l, t, r, b = font.getbbox(text)
    bg = rng.randrange(222, 256)
    im = Image.new('L', (max(80, r - l + 28), max(60, b - t + 26)), bg)
    if text:
        ImageDraw.Draw(im).text((14 - l, 12 - t), text, font=font, fill=rng.randrange(18, 154))
    im = im.rotate(rng.uniform(-3, 3), resample=Image.Resampling.BICUBIC, fillcolor=bg)
    gray = np.asarray(im)
    if rng.random() < .32:
        gray = cv2.GaussianBlur(gray, (3, 3), rng.uniform(.35, .95))
    gray = cv2.resize(
        gray, (round(gray.shape[1] * rng.uniform(.82, 1.18)), gray.shape[0]), interpolation=cv2.INTER_LINEAR
    )
    if rng.random() < .40:
        gray = np.clip(gray + noise.normal(0, rng.uniform(.5, 5), gray.shape), 0, 255).astype(np.uint8)
    return (prepare(gray) * 255).astype(np.uint8)


def corpus(size, files, seed):
    rng = random.Random(seed)
    noise = np.random.default_rng(seed)
    fonts = [ImageFont.truetype(str(file), point) for file in files for point in (27, 33, 38, 44)]
    for font in fonts[::4]:
        missing = bytes(font.getmask('\U0010FFFF'))
        gaps = ''.join(c for c in ALPHABET if c != ' ' and bytes(font.getmask(c)) == missing)
        if gaps:
            raise ValueError(f'{font.path} lacks glyphs: {gaps}')
    pixels = np.empty((size, 1, HEIGHT, WIDTH), dtype=np.uint8)
    labels = np.zeros((size, 40), dtype=np.int32)
    lengths = np.zeros(size, dtype=np.int64)
    texts = []
    for i in range(size):
        text = example_text(rng)
        texts.append(text)
        pixels[i] = render(text, rng.choice(fonts), rng, noise)
        row = [LABELS[c] for c in text]
        labels[i, :len(row)] = row
        lengths[i] = len(row)
    return pixels, labels, lengths, texts


def export(model, target):
    model.eval()
    spec = paddle.static.InputSpec([None, 1, HEIGHT, WIDTH], 'float32', 'image')
    # Paddle 3.3 hardcodes the to_static scratch directory under the user's cache.
    with TemporaryDirectory(dir=target) as scratch, patch(
        'paddle.jit.dy2static.utils.get_temp_dir', return_value=scratch
    ):
        paddle.jit.save(paddle.jit.to_static(model, input_spec=[spec], full_graph=True), str(target / 'inference'))
    (target / 'alphabet.json').write_text(json.dumps(ALPHABET, ensure_ascii=False) + '\n')


def train(args):
    paddle.seed(SEED)
    train_files = sorted(args.fonts.glob('*.ttf'))
    validation_files = sorted(args.validation_fonts.glob('*.ttf'))
    file_hashes = lambda files: {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
    if len(train_files) < 3 or not validation_files or set(file_hashes(train_files).values()) & set(file_hashes(validation_files).values()):
        raise ValueError('Use separate training and validation fonts')
    args.output.mkdir(parents=True, exist_ok=True)
    print(f'Preparing {args.samples} synthetic cells', flush=True)
    x, y, lengths, _ = corpus(args.samples, train_files, SEED)
    xv, _, _, expected = corpus(384, validation_files, SEED + 1)
    model = Recognition()
    rng = np.random.default_rng(SEED)
    steps = (len(x) + args.batch - 1) // args.batch * args.epochs
    scheduler = paddle.optimizer.lr.CosineAnnealingDecay(.003, T_max=steps, eta_min=.0005)
    optim = paddle.optimizer.AdamW(learning_rate=scheduler, parameters=model.parameters(), grad_clip=nn.ClipGradByGlobalNorm(5))
    ctc = nn.CTCLoss(blank=0, reduction='mean')
    best = -1
    records = []
    for epoch in range(args.epochs):
        model.train()
        losses = []
        for ids in np.array_split(rng.permutation(len(x)), (len(x) + args.batch - 1) // args.batch):
            output = model(paddle.to_tensor(x[ids], dtype='float32') / 255)
            loss = ctc(output.transpose([1, 0, 2]), paddle.to_tensor(y[ids]),
                       paddle.full([len(ids)], output.shape[1], dtype='int64'), paddle.to_tensor(lengths[ids]))
            if not bool(paddle.isfinite(loss).item()):
                raise ValueError('Non-finite CTC loss')
            loss.backward()
            optim.step()
            optim.clear_grad()
            scheduler.step()
            losses.append(float(loss))
        model.eval()
        with paddle.no_grad():
            recognized = []
            for start in range(0, len(xv), 32):
                output = model(paddle.to_tensor(xv[start:start+32], dtype='float32') / 255)
                recognized.extend(row['rec_text'] for row in decode(output.numpy(), ALPHABET))
        exact = sum(result.casefold() == text.casefold() for result, text in zip(recognized, expected)) / len(expected)
        record = dict(epoch=epoch + 1, loss=float(np.mean(losses)), exact=exact)
        records.append(record)
        print(json.dumps(record), flush=True)
        if exact > best:
            best = exact
            export(model, args.output)
        receipt = dict(seed=SEED, samples=args.samples, validation=384, training_fonts=file_hashes(train_files),
                       validation_fonts=file_hashes(validation_files), epochs=records)
        (args.output / 'training.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('fonts', type=Path)
    parser.add_argument('validation_fonts', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--samples', type=int, default=9216)
    parser.add_argument('--epochs', type=int, default=22)
    parser.add_argument('--batch', type=int, default=64)
    train(parser.parse_args())
