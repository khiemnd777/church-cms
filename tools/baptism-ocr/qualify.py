"""Score P7.4-r2 development or a sealed, independently collected mixed corpus."""

import argparse
import hashlib
import json
import platform
import re
import time
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import paddle
from PIL import Image

from benchmark import normalize, normalize_date
from worker import MODEL_PAIRS, VI_MODEL, deskew, grid, make_engine, read_page, recognize_cells


FIELDS = ('name', 'date', 'place', 'officiant')
THRESHOLDS = dict(row=.95, name=.85, date=.90, place=.75, officiant=.75, p95=15)
ADVERSE = {'unreadable', 'unsupported', 'missing_header', 'no_table'}
INPUT_LIMIT = 5 * 1024 * 1024


def as_date(text):
    written = re.fullmatch(r'(?:ngày\s+)?(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})', normalize(text))
    return normalize_date('/'.join(written.groups()) if written else text)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs(models, family):
    root = Path(__file__).parent
    lock = json.loads((root / 'model-lock.json').read_text())
    names = [*MODEL_PAIRS[family], *([VI_MODEL] if family == 'vi' else [])]
    files = {name: {file: digest(models / f'{name}_infer' / file) for file in lock[name]['files']}
             for name in names}
    return dict(family=family, models=files, benchmark={name: digest(root / name) for name in
                ('benchmark.py', 'holdout.py', 'qualify.py', 'vietnamese.py', 'worker.py', 'model-lock.json')},
                machine=platform.machine(), paddle=paddle.__version__)


def freeze(args):
    if args.development is None:
        raise ValueError('Provide the passing development report before freezing a model')
    identity = inputs(args.models, args.family)
    report = json.loads(args.development.read_text())
    if report.get('mode') != 'dev' or report.get('passed') is not True or report.get('identity') != identity:
        raise ValueError('Development gate did not pass for this exact model and scorer')
    with args.output.open('x') as stream:
        stream.write(json.dumps(identity, indent=2) + '\n')


def validate_independent(pages, corpus):
    if len(pages) != 28 or len({p['image'] for p in pages}) != 28 or len({p['sha256'] for p in pages}) != 28:
        raise ValueError('Expected 28 distinct images')
    counts = Counter((p['style'], p['quality']) for p in pages)
    if counts != {('font', 'clear'): 6, ('font', 'difficult'): 6, ('handwritten', 'clear'): 6,
                  ('handwritten', 'difficult'): 6, ('adverse', 'adverse'): 4}:
        raise ValueError('The mixed holdout must have six pages per readable group and four adverse pages')
    if {p['case'] for p in pages if p['style'] == 'adverse'} != ADVERSE:
        raise ValueError('Expected one example per adverse case')
    writers = [p['writer'] for p in pages if p['style'] == 'handwritten']
    if len(set(writers)) < 4 or any(not isinstance(writer, str) or not writer.strip() for writer in writers):
        raise ValueError('Expected at least four distinct handwriting IDs')
    source_ids = set()
    for page in pages:
        name = page['image']
        if name != Path(name).name or Path(name).suffix.lower() not in ('.png', '.jpg', '.jpeg'):
            raise ValueError('Images must be local PNG/JPEG files in the corpus folder')
        file = corpus / name
        if file.is_symlink() or file.stat().st_size > INPUT_LIMIT or digest(file) != page['sha256']:
            raise ValueError(f'Image integrity or size mismatch for {name}')
        with Image.open(file) as image:
            if image.format not in ('JPEG', 'PNG') or image.width * image.height > 20_000_000:
                raise ValueError(f'Unsupported image or pixel limit exceeded for {name}')
            image.verify()
        if not page['source_id'] or page['source_id'] in source_ids:
            raise ValueError('Every page needs a distinct source ID')
        source_ids.add(page['source_id'])
        if page['style'] != 'adverse':
            rows = page['rows']
            if len(rows) != 8 or any(len(r['fields']) != 4 or not 0 < r['y'] < 1 or
                                     not r['fields'][0].strip() for r in rows):
                raise ValueError(f'Expected eight annotated rows in {name}')
            if any(left['y'] >= right['y'] for left, right in zip(rows, rows[1:])):
                raise ValueError(f'Expected strictly ordered source row centers in {name}')
            if any(r['date'] != as_date(r['fields'][1]) for r in rows):
                raise ValueError(f'Date labels must come from the source text in {name}')


def matched(rows, result):
    if not rows or 'y' not in rows[0]:
        # The r1 corpus has no row locations. Preserve the dev comparison rule.
        return list(range(len(rows))) if len(rows) == len(result['rows']) else [None] * len(rows)
    centers = result.get('row_centers', [])
    gold = [r['y'] for r in rows]
    max_shift = min(b - a for a, b in zip(gold, gold[1:])) * .47
    pairs = [None] * len(gold)
    for index, y in enumerate(centers):
        nearest = min(range(len(gold)), key=lambda i: abs(gold[i] - y))
        if abs(gold[nearest] - y) <= max_shift and (
            pairs[nearest] is None or abs(gold[nearest] - y) < abs(gold[nearest] - centers[pairs[nearest]])
        ):
            pairs[nearest] = index
    return pairs


def score_fields(label, cells, metrics):
    for index, field in enumerate(FIELDS):
        text = cells[index]['text'] if cells else ''
        source = label['fields'][index]
        if not source.strip():
            metrics[f'{field}.empty'] += 1
            metrics[f'{field}.false_value'] += bool(text.strip())
        expected = label['date'] if field == 'date' else normalize(source)
        actual = as_date(text) if field == 'date' else normalize(text)
        if expected:
            metrics[f'{field}.total'] += 1
            outcome = 'correct' if actual == expected else 'wrong' if text.strip() else 'missing'
            metrics[f'{field}.{outcome}'] += 1
        elif field == 'date' and source.strip():
            metrics['date.unclear'] += 1
            metrics['date.false_date'] += bool(actual)


def score_page(page, result, metrics):
    rows = page['rows']
    decoded = result['rows']
    pairs = matched(rows, result)
    metrics['row.total'] += len(rows)
    metrics['row.extra'] += max(0, len(decoded) - sum(i is not None for i in pairs)) if 'y' in rows[0] else max(0, len(decoded) - len(rows))
    for label, index in zip(rows, pairs):
        cells = decoded[index] if index is not None else []
        found = any(cell['text'].strip() for cell in cells) if 'y' in label else bool(cells and cells[0]['text'].strip())
        metrics['row.correct'] += found
        metrics['row.missing'] += not found
        metrics['row.review'] += not cells or any(not c['text'].strip() or c['score'] < .85 for c in cells)
        score_fields(label, cells, metrics)


def score_crops(raw, page, engine, metrics):
    image, _ = deskew(cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR))
    bounds = grid(image)
    if bounds is None or len(bounds[1]) != len(page['rows']) + 2:
        return False
    xs, ys = bounds
    selected, labels = [], {}
    for r, label in enumerate(page['rows']):
        for c, text in enumerate(label['fields']):
            if text.strip():
                cell = image[ys[r+1]+5:ys[r+2]-5, xs[c]+5:xs[c+1]-5]
                index = r * len(FIELDS) + c
                selected.append((index, cell))
                labels[index] = (FIELDS[c], text)
    for index, out in recognize_cells(engine, selected):
        field, expected = labels[index]
        metrics[f'{field}.total'] += 1
        metrics[f'{field}.correct'] += normalize(expected) == normalize(out['rec_text'])
    return True


def summary(metrics):
    result = {}
    for field in ('row', *FIELDS):
        total = metrics[f'{field}.total']
        keys = ('extra', 'review') if field == 'row' else ('wrong', 'empty', 'false_value')
        if field == 'date':
            keys += ('unclear', 'false_date')
        correct = metrics[f'{field}.correct']
        result[field] = dict(total=total, correct=correct, ratio=correct / total if total else None,
                             **{k: metrics[f'{field}.{k}'] for k in ('missing', *keys)})
    return result


def measure(args):
    identity = inputs(args.models, args.family)
    manifest = args.corpus / 'manifest.json'
    labels = json.loads(manifest.read_text())
    pages = labels['pages']
    if args.mode == 'independent':
        if args.seal is None or args.freeze is None:
            raise ValueError('Independent scoring requires a frozen model and a separately sealed manifest')
        if (json.loads(args.freeze.read_text()) != identity or args.seal != digest(manifest) or
                labels.get('freeze_sha256') != digest(args.freeze)):
            raise ValueError('Frozen inputs or manifest checksum mismatch')
        validate_independent(pages, args.corpus)
    elif args.mode == 'dev':
        pages = [p for p in pages if p['split'] == 'dev']
    else:
        pages = [p for p in pages if p['split'] == 'eval']
    started = time.monotonic()
    engine = make_engine(str(args.models), args.family)
    startup_seconds = time.monotonic() - started
    stats = {'all': Counter()}
    times, adverse, details = [], [], []
    crop_counts = Counter()
    missed_crop_pages = []
    for page in pages:
        raw = (args.corpus / page['image']).read_bytes()
        result = read_page(engine, raw, with_geometry=args.mode == 'independent')
        details.append({'image': page['image'], **result})
        if page['quality'] == 'adverse':
            adverse.append(dict(image=page['image'], handled=result['status'] == 'layout' and not result['rows']))
            continue
        times.append(result['elapsed'])
        score_page(page, result, stats['all'])
        score_page(page, result, stats.setdefault(page['quality'], Counter()))
        if 'style' in page:
            score_page(page, result, stats.setdefault(page['style'], Counter()))
            score_page(page, result, stats.setdefault(f"{page['style']}.{page['quality']}", Counter()))
        if args.mode == 'dev' and not score_crops(raw, page, engine, crop_counts):
            missed_crop_pages.append(page['image'])
    metrics = {group: summary(values) for group, values in stats.items()}
    p95 = float(np.percentile(times[1:], 95, method='inverted_cdf'))
    passed = all((metrics['all'][k]['ratio'] or 0) >= THRESHOLDS[k] for k in ('row', *FIELDS))
    passed = passed and p95 <= THRESHOLDS['p95']
    if args.mode != 'dev':
        passed = passed and len(adverse) == 4 and all(item['handled'] for item in adverse)
    report = dict(mode=args.mode, identity=identity, manifest=digest(manifest), passed=passed,
                  startup_seconds=startup_seconds, cold_first_page_seconds=startup_seconds + times[0],
                  p95_seconds=p95, threshold=THRESHOLDS, metrics=metrics, adverse=adverse, pages=details)
    if args.mode == 'dev':
        report['cell_crops'] = dict(counts=crop_counts, missing_pages=missed_crop_pages)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('identity', 'pages')}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('freeze', 'dev', 'regression', 'independent'))
    parser.add_argument('models', type=Path)
    parser.add_argument('corpus', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--family', choices=MODEL_PAIRS, default='vi')
    parser.add_argument('--freeze', type=Path)
    parser.add_argument('--seal')
    parser.add_argument('--development', type=Path)
    args = parser.parse_args()
    if args.mode == 'freeze':
        freeze(args)
    else:
        measure(args)
