"""Local OCR worker. Stdout contains one JSON result; image bytes stay in memory."""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

import cv2
import numpy as np

from vietnamese import CellRecognition


MODEL_PAIRS = {
    'v6': ('PP-OCRv6_small_det', 'PP-OCRv6_small_rec'),
    'v5': ('PP-OCRv5_mobile_det', 'latin_PP-OCRv5_mobile_rec'),
    'vi': ('PP-OCRv6_small_det', 'PP-OCRv6_small_rec'),
}
VI_MODEL = 'p74_vi_rec'


def make_engine(root, family):
    from paddleocr import TextDetection, TextRecognition
    det, rec = MODEL_PAIRS[family]
    names = (det, rec, VI_MODEL) if family == 'vi' else (det, rec)
    paths = [Path(root) / (name + '_infer') for name in names]
    with open(os.path.join(os.path.dirname(__file__), 'model-lock.json')) as f:
        lock = json.load(f)
    for name, path in zip(names, paths):
        for filename, expected in lock[name]['files'].items():
            with (path / filename).open('rb') as f:
                if hashlib.file_digest(f, 'sha256').hexdigest() != expected:
                    raise RuntimeError('LOCAL_MODEL_CHECKSUM')
    params = dict(device='cpu', engine='paddle_static', cpu_threads=2, enable_mkldnn=False)
    detector = TextDetection(model_name=det, model_dir=str(paths[0]), **params)
    header = TextRecognition(model_name=rec, model_dir=str(paths[1]), **params)
    if family == 'vi':
        alphabet = json.loads((paths[2] / 'alphabet.json').read_text())
        return detector, header, CellRecognition(paths[2], alphabet)
    return detector, header, header


def positions(mask, axis, length):
    summed = np.count_nonzero(mask, axis=axis)
    pixels = np.flatnonzero(summed >= length * .31)
    groups = np.split(pixels, np.where(np.diff(pixels) > 4)[0] + 1)
    return [int(np.median(g)) for g in groups if len(g)]


def deskew(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 55, 155)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 1800, threshold=90,
                            minLineLength=image.shape[1] // 3, maxLineGap=35)
    if lines is None:
        return image, None
    angles = [np.degrees(np.arctan2(y2-y1, x2-x1))
              for x1, y1, x2, y2 in lines[:, 0]
              if abs(x2-x1) > image.shape[1] // 3 and abs(y2-y1) < abs(x2-x1)*.20]
    if not angles:
        return image, None
    angle = float(np.median(angles))
    h, w = image.shape[:2]
    transform = cv2.getRotationMatrix2D((w/2, h/2), angle, 1)
    return cv2.warpAffine(image, transform, (w, h), borderValue=(255, 255, 255)), cv2.invertAffineTransform(transform)


def grid(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    ink = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                cv2.THRESH_BINARY_INV, 31, 9)
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(32,w//14)), np.uint8))
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((max(24,h//19),1), np.uint8))
    ys, xs = positions(horizontal, 1, w), positions(vertical, 0, h)
    if len(xs) not in (5, 6) or not 3 <= len(ys) <= 22:
        return None
    if min(np.diff(xs)) < w*.021 or min(np.diff(ys)) < h*.018:
        return None
    if xs[0] < 5 or ys[0] < 5 or xs[-1] > w-5 or ys[-1] > h-5:
        return None
    if len(xs) == 6:
        if xs[1]-xs[0] >= w*.11:
            return None
        xs = xs[1:]
    return xs, ys


def cropped_text(cell, gray):
    ink = np.argwhere(gray < 160)
    if not len(ink):
        return cell
    y0, x0 = np.maximum(ink.min(axis=0)-5, 0)
    y1, x1 = ink.max(axis=0)+6
    return cell[y0:y1, x0:x1]


def supported_header(rec, image, xs, ys):
    names = ({'hoten','hovaten'}, {'ngay','ngaybaptem'},
             {'noi','diadiem','noibaptem'}, {'nguoicuhanh','cuhanh'})
    cells = [image[ys[0]+5:ys[1]-5, x+5:xs[i+1]-5] for i,x in enumerate(xs[:-1])]
    labels = rec.predict([cropped_text(c,cv2.cvtColor(c,cv2.COLOR_BGR2GRAY)) for c in cells], batch_size=4)
    def normalized(label):
        return re.sub('[^a-z]', '', unicodedata.normalize('NFD',label.lower()).replace('đ','d'))
    return sum(normalized(value['rec_text']) in expected for value, expected in zip(labels,names)) >= 2


def recognize_cells(engine, indexed_cells):
    _, header, text_recognizer = engine
    batches = {}
    for index, cell in indexed_cells:
        # Keep the r1 date recognizer, which passed the approved date threshold.
        recognizer = header if index % 4 == 1 else text_recognizer
        if recognizer is header:
            cell = cropped_text(cell, cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY))
        batches.setdefault(recognizer, []).append((index, cell))
    for recognizer, batch in batches.items():
        outputs = recognizer.predict([cell for _, cell in batch], batch_size=8)
        for (index, _), value in zip(batch, outputs, strict=True):
            yield index, value


def read_page(engine, raw, with_geometry=False):
    start = time.monotonic()
    if not raw or len(raw) > 5*1024*1024:
        raise ValueError('BAD_IMAGE_SIZE')
    im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if im is None or im.shape[0]*im.shape[1] > 20_000_000:
        raise ValueError('BAD_IMAGE')
    im, inverse = deskew(im)
    det, header, _ = engine
    bounds = grid(im)
    if bounds is None:
        return dict(status='layout', rows=[], elapsed=time.monotonic()-start)
    xs, ys = bounds
    if not supported_header(header, im, xs, ys):
        return dict(status='layout', rows=[], elapsed=time.monotonic()-start)
    cells = []
    for i, y in enumerate(ys[1:-1], 1):
        for j, x in enumerate(xs[:-1]):
            pad = 5
            cells.append(im[y+pad:ys[i+1]-pad, x+pad:xs[j+1]-pad])
    # Detect text on the deskewed table without ruling lines, then read full cell
    # crops to retain accents and the relationship between text and columns.
    table = np.full_like(im, 255)
    for i, y in enumerate(ys[1:-1], 1):
        for j, x in enumerate(xs[:-1]):
            table[y+5:ys[i+1]-5, x+5:xs[j+1]-5] = cells[(i-1)*4+j]
    detected = list(det.predict(table, limit_side_len=1600, limit_type='max'))[0]
    boxes = detected['dt_polys']
    counts = np.zeros(len(cells), dtype=int)
    for box in boxes:
        x,y = np.asarray(box).mean(axis=0)
        row, col = np.searchsorted(ys, y)-2, np.searchsorted(xs, x)-1
        if 0 <= row < len(cells)//4 and 0 <= col < 4:
            counts[int(row)*4+int(col)] += 1
    recognized = []
    for index, cell in enumerate(cells):
        gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
        if counts[index] != 0 or np.count_nonzero(gray < 135) >= gray.size*.001:
            recognized.append((index, cell))
    values = [dict(text='', score=0.0) for _ in cells]
    for index, value in recognize_cells(engine, recognized):
        values[index] = dict(text=str(value['rec_text'])[:200], score=float(value['rec_score']))
    rows = [values[i:i+4] for i in range(0,len(values),4)]
    if not any(any(c['text'] for c in row) for row in rows):
        return dict(status='layout', rows=[], elapsed=time.monotonic()-start)
    result = dict(status='ok', rows=rows, elapsed=time.monotonic()-start)
    if with_geometry:
        # Compare row centers at the center of the table in the source image.
        centers = np.array([[(xs[0] + xs[-1]) / 2, (top + bottom) / 2, 1]
                            for top, bottom in zip(ys[1:-1], ys[2:])])
        y = centers @ inverse[1] if inverse is not None else centers[:, 1]
        result['row_centers'] = (y / im.shape[0]).tolist()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('models')
    parser.add_argument('--family', choices=MODEL_PAIRS, default='v6')
    args = parser.parse_args()
    # Paddle progress is kept off the result stream and out of application logs.
    stdout = sys.stdout
    sys.stdout = sys.stderr
    engine = make_engine(args.models, args.family)
    result = read_page(engine, sys.stdin.buffer.read(5*1024*1024+1))
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), file=stdout, flush=True)
