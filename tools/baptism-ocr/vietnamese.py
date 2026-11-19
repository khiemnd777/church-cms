"""CPU recognition for a cropped cell, with an explicit Vietnamese CTC alphabet."""

import unicodedata

import cv2
import numpy as np


ACCENTED = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'
ALPHABET = ''.join(dict.fromkeys(
    ' 0123456789/-.…abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' + ACCENTED + ACCENTED.upper()
))
HEIGHT, WIDTH = 32, 224


def prepare(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    ink = np.maximum(np.percentile(gray, 90) - gray.astype(np.float32), 0)
    peak = float(np.percentile(ink[ink > 12], 95)) if np.any(ink > 12) else 0
    canvas = np.zeros((1, HEIGHT, WIDTH), dtype=np.float32)
    if peak < 22:
        return canvas
    points = np.argwhere(ink > max(18, peak * .12))
    top, left = points.min(axis=0)
    bottom, right = points.max(axis=0) + 1
    glyphs = np.clip(ink[top:bottom, left:right] / peak, 0, 1)
    h, w = glyphs.shape
    target_width = max(1, min(WIDTH - 8, round(w * 26 / h)))
    canvas[0, 3:29, 4:4 + target_width] = cv2.resize(
        glyphs, (target_width, 26), interpolation=cv2.INTER_AREA if h > 26 else cv2.INTER_LINEAR
    )
    return canvas


def decode(logits, alphabet):
    token_ids = logits.argmax(axis=2)
    scores = np.exp(logits - logits.max(axis=2, keepdims=True))
    confidence = 1 / scores.sum(axis=2)
    for ids, probs in zip(token_ids, confidence):
        indices = np.flatnonzero((ids > 0) & (ids != np.r_[0, ids[:-1]]))
        text = unicodedata.normalize('NFC', ''.join(alphabet[ids[i] - 1] for i in indices).strip())
        yield dict(rec_text=text, rec_score=float(probs[indices].mean()) if len(indices) else 0.0)


class CellRecognition:
    def __init__(self, root, alphabet):
        from paddle import inference

        if alphabet != ALPHABET:
            raise ValueError('VI_ALPHABET_MISMATCH')
        config = inference.Config(str(root / 'inference.json'), str(root / 'inference.pdiparams'))
        config.disable_gpu()
        config.set_cpu_math_library_num_threads(2)
        config.disable_glog_info()
        self.predictor = inference.create_predictor(config)
        self.inputs = self.predictor.get_input_handle(self.predictor.get_input_names()[0])
        self.outputs = self.predictor.get_output_handle(self.predictor.get_output_names()[0])
        self.alphabet = alphabet

    def predict(self, images, batch_size=8):
        for start in range(0, len(images), batch_size):
            batch = np.stack([prepare(img) for img in images[start:start + batch_size]])
            self.inputs.reshape(batch.shape)
            self.inputs.copy_from_cpu(batch)
            self.predictor.run()
            yield from decode(self.outputs.copy_to_cpu(), self.alphabet)
