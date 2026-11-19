"""Prepare a private P7.4-r2 holdout packet after the recognizer has been frozen."""

import argparse
import csv
import json
import random
import secrets
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from qualify import as_date, digest, validate_independent


SURNAME = ('Giang', 'Quách', 'Hà', 'Vương', 'Tăng', 'Châu', 'Triệu', 'Lý', 'Dư', 'Mai')
MIDDLE = ('Thanh', 'Như', 'Thế', 'Diệu', 'Trọng', 'Quý', 'Vĩnh', 'Nguyên', 'Thi', 'Sĩ')
GIVEN = ('Tú', 'Tụ', 'Tự', 'Tử', 'Từ', 'Tư', 'Tứ', 'Tữ', 'Đăng', 'Thống', 'Ngọ', 'Tưởng')
PLACES = ('Thủ Dầu Một', 'Bến Nghé', 'An Nhơn', 'Cẩm Phả', 'Phan Rang', 'Ninh Hòa', 'Thốt Nốt', 'Định Quán')
W, H = 1660, 1140
Y = [136 + 100 * i for i in range(10)]
CENTER = [(Y[i] + Y[i+1]) / (2*H) for i in range(1, 9)]


def labels(rng, ordinal, seen):
    def person():
        return ' '.join((rng.choice(SURNAME), rng.choice(MIDDLE), rng.choice(GIVEN)))
    result = []
    for i, y in enumerate(CENTER):
        if i == 0:
            stem = f'{rng.choice(SURNAME)} {rng.choice(MIDDLE)}'
            variants = [f'{stem} {last}' for last in GIVEN[:8] if f'{stem} {last}' not in seen]
            while len(variants) < 2:
                stem = f'{rng.choice(SURNAME)} {rng.choice(MIDDLE)}'
                variants = [f'{stem} {last}' for last in GIVEN[:8] if f'{stem} {last}' not in seen]
            similar_names = rng.sample(variants, 2)
        name = similar_names[i] if i < 2 else person()
        while name in seen:
            name = person()
        seen.add(name)
        d, m, year = rng.randint(1, 27), rng.randint(1, 12), rng.randint(1935, 2026)
        style = (ordinal+i) % 5
        dates = (f'{d}/{m}/{year}', f'{d:02d}.{m:02d}.{year}', f'{d}-{m}-{year}',
                 f'ngày {d} tháng {m} năm {year}', f'{d}/{m}/…')
        date = dates[style] if i or ordinal % 3 else ''
        fields = [name, date, '' if (ordinal+i)%7 == 0 else rng.choice(PLACES),
                  '' if (ordinal+i)%9 == 0 else person()]
        result.append(dict(fields=fields, date=as_date(date), y=y))
    return result


def table(font, rows=None, ordinal=0, difficult=False):
    paper = Image.new('RGB', (W, H), (255, 253, 244))
    draw = ImageDraw.Draw(paper)
    header = ImageFont.truetype(str(font), 35)
    data = ImageFont.truetype(str(font), 34)
    indexed = ordinal % 2 == 1
    cols = ([42, 135] if indexed else [42]) + [480, 910, 1220, 1610]
    draw.text((45, 32), 'SỔ BÁP-TÊM · PHIẾU HƯ CẤU', font=header, fill=(35, 45, 54))
    for x in cols:
        draw.line((x, Y[0], x, Y[-1]), fill=(90, 98, 107), width=2)
    for y in Y:
        draw.line((cols[0], y, cols[-1], y), fill=(90, 98, 107), width=2)
    titles = ('Họ tên', 'Ngày', 'Nơi', 'Người cử hành')
    for x, title in zip(cols, ('STT', *titles) if indexed else titles):
        draw.text((x+14, Y[0]+22), title, font=header, fill=(29, 35, 58))
    for i in range(8):
        if indexed:
            draw.text((cols[0]+14, Y[i+1]+20), str(i+1), font=header, fill=(29, 35, 58))
        if rows:
            for x, value in zip(cols[int(indexed):], rows[i]['fields']):
                draw.text((x+13, Y[i+1]+19), value, font=data, fill=(34, 49, 86))
    if difficult and rows:
        paper = paper.rotate((-1 if indexed else 1) * 2.4, Image.Resampling.BICUBIC, fillcolor=(255, 253, 244))
        paper = paper.filter(ImageFilter.GaussianBlur(.75))
        # The rotation preserves the y-coordinate of the center of the table.
    return paper


def font_key(name):
    return ''.join(c for c in name.casefold() if c.isalnum())


def list_font_paths(folder, exclude, excluded_names):
    fonts = sorted(folder.glob('*.ttf'))
    if len(fonts) < 3:
        raise ValueError('Provide at least three newly held-out Vietnamese fonts')
    if {digest(path) for path in fonts} & set(exclude):
        raise ValueError('Font overlap with development, training or r1')
    seen_families = {font_key(name) for name in excluded_names}
    for font in fonts:
        loaded = ImageFont.truetype(str(font), 35)
        family = font_key(loaded.getname()[0])
        if family in seen_families:
            raise ValueError(f'{font.name} repeats a previously selected font family')
        seen_families.add(family)
        missing = bytes(loaded.getmask('\U0010FFFF'))
        field_chars = set(' '.join(SURNAME+MIDDLE+GIVEN+PLACES) + 'ngày tháng năm Người cử hành họ tên…')
        if any(bytes(loaded.getmask(c)) == missing for c in field_chars):
            raise ValueError(f'{font.name} does not cover the Vietnamese labels')
    return fonts


def prepare(args):
    training = json.loads(args.training.read_text())
    r1 = json.loads(args.r1.read_text())
    excluded = set(training['training_fonts'].values()) | set(training['validation_fonts'].values()) | set(r1['fonts'].values())
    frozen = json.loads(args.freeze.read_text())
    if frozen.get('family') != 'vi' or not frozen.get('models') or not frozen.get('benchmark'):
        raise ValueError('Use the freeze file for the selected Vietnamese model')
    excluded_names = [*r1['fonts'], *(Path(name).stem for name in
                      (*training['training_fonts'], *training['validation_fonts']))]
    fonts = list_font_paths(args.fonts, excluded, excluded_names)
    args.output.mkdir(parents=True, exist_ok=False)
    templates = args.output / 'blank-templates'
    templates.mkdir()
    rng = random.Random(secrets.randbits(128))
    pending = []
    pages = []
    seen = {row['fields'][0] for page in r1['pages'] for row in page['rows']}
    for i in range(24):
        rows = labels(rng, i, seen)
        difficult = i % 12 >= 6
        style = 'font' if i < 12 else 'handwritten'
        filename = f'p74-r2-{i+1:02}.jpg'
        font = fonts[i % len(fonts)]
        page = dict(image=filename, style=style, quality='difficult' if difficult else 'clear',
                    source_id=secrets.token_hex(12), rows=rows, layout='stt' if i%2 else 'four_columns')
        if style == 'font':
            path = args.output / filename
            table(font, rows, i, difficult).save(path, quality=92 if not difficult else 84)
            pages.append({**page, 'font_sha256': digest(font), 'sha256': digest(path)})
        else:
            table(font, ordinal=i).save(templates / (Path(filename).stem + '.png'))
            pending.append(page)
    def damaged_source(offset):
        return table(fonts[0], labels(rng, offset, seen), ordinal=offset)

    adverse = {
        'unreadable': damaged_source(24).filter(ImageFilter.GaussianBlur(26)),
        'unsupported': damaged_source(25).crop((0, 0, W-360, H)),
        'missing_header': damaged_source(26).crop((0, Y[1]+25, W, H)),
        'no_table': Image.new('RGB', (W,H), (255,253,244)),
    }
    for i, (case, image) in enumerate(adverse.items(), 25):
        filename = f'p74-r2-{i:02}.jpg'
        path = args.output / filename
        image.save(path, quality=90)
        pages.append(dict(image=filename, case=case, style='adverse', quality='adverse',
                          source_id=secrets.token_hex(12), sha256=digest(path)))
    with (args.output / 'writer-prompts.csv').open('w', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(('Trang', 'Dòng', 'Họ tên', 'Ngày', 'Nơi', 'Người cử hành'))
        for page in pending:
            for i, row in enumerate(page['rows'], 1):
                writer.writerow((page['image'], i, *row['fields']))
    receipt = dict(freeze_sha256=digest(args.freeze), pages=pages, pending_handwritten=pending)
    (args.output / 'packet.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')


def seal(args):
    packet = json.loads((args.output / 'packet.json').read_text())
    captured = json.loads(args.captures.read_text())
    for page in packet['pending_handwritten']:
        item = captured[page['image']]
        page['writer'] = item['writer']
        if not isinstance(page['writer'], str) or not page['writer'].strip():
            raise ValueError('Use a pseudonymous writer ID for every handwritten page')
        if len(item['rows']) != 8:
            raise ValueError(f"Missing source row annotation for {page['image']}")
        # Score the ink as independently transcribed, including copy mistakes.
        for row, observed in zip(page['rows'], item['rows'], strict=True):
            row.update(fields=observed['fields'], y=observed['y'], date=as_date(observed['fields'][1]))
        page['sha256'] = digest(args.output / page['image'])
    pages = packet['pages'] + packet['pending_handwritten']
    validate_independent(pages, args.output)
    manifest = args.output / 'manifest.json'
    with manifest.open('x') as stream:
        stream.write(json.dumps(dict(freeze_sha256=packet['freeze_sha256'], pages=pages), ensure_ascii=False, indent=2)+'\n')
    print(digest(manifest))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='mode', required=True)
    packet = commands.add_parser('prepare')
    packet.add_argument('fonts', type=Path)
    packet.add_argument('training', type=Path)
    packet.add_argument('r1', type=Path)
    packet.add_argument('freeze', type=Path)
    packet.add_argument('output', type=Path)
    sealed = commands.add_parser('seal')
    sealed.add_argument('output', type=Path)
    sealed.add_argument('captures', type=Path)
    options = parser.parse_args()
    (prepare if options.mode == 'prepare' else seal)(options)
