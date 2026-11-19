"""Build the approved 32-page synthetic OCR corpus, without any real records."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont


WRITERS = {
    'dev': ['dancingscript', 'itim', 'patrickhand'],
    'eval': ['mali', 'shantellsans', 'sriracha'],
}
SURNAME = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Võ', 'Đặng', 'Hoàng', 'Dương']
MIDDLE = ['Văn', 'Thị', 'Minh', 'Hải', 'Ngọc', 'Anh', 'Đức']
GIVEN = ['An', 'Ân', 'Ánh', 'Hòa', 'Hoà', 'Hường', 'Hạnh', 'Khải', 'Ứng', 'Đạt', 'Yến']
PLACES = ['Huế', 'Đà Nẵng', 'Hội An', 'Đà Lạt', 'Bến Tre', 'Long Xuyên', 'Phú Yên']


def create_page(i, output, fonts):
    rng = random.Random(740000+i)
    split = 'dev' if i < 12 else 'eval'
    quality = 'clear' if i < 6 or 12 <= i < 20 else 'difficult' if i < 28 else 'adverse'
    writer = WRITERS[split][i % 3]
    with_index = i % 2 == 1
    paper = Image.new('RGB', (1660, 1140), (255, 253, 244))
    pen = ImageDraw.Draw(paper)
    font = ImageFont.truetype(str(fonts / (writer+'.ttf')), 43)
    label_font = ImageFont.truetype(str(fonts / (writer+'.ttf')), 36)
    pen.text((69,31), 'SỔ BÁP-TÊM · TRANG GIẢ LẬP', fill=(31,36,47), font=label_font)
    xs = ([63, 142] if with_index else [63]) + [562, 901, 1175, 1590]
    if i == 30: xs.insert(3, 700)
    ys = [136+100*j for j in range(10)]
    for x in xs:
        pen.line((x, ys[0], x, ys[-1]), fill=(97,108,116), width=2)
    for y in ys:
        pen.line((xs[0], y, xs[-1], y), fill=(97,108,116), width=2)
    for x, title in zip(xs, (['STT'] if with_index else []) + ['Họ tên', 'Ngày', 'Nơi', 'Người cử hành']):
        pen.text((x+12,ys[0]+18),title,font=label_font,fill=(26,37,48))
    truth = []
    for j in range(8):
        head = lambda: ' '.join([rng.choice(SURNAME),rng.choice(MIDDLE),rng.choice(GIVEN)])
        person = head()
        if j == 1 and i % 3 == 0: person = truth[-1]['fields'][0]
        day,month,year = rng.randint(1,27),rng.randint(1,12),rng.randint(1992,2009)
        sep = '/' if i % 3 in (0,1) else '-'
        date = f'{day:02d}{sep}{month:02d}{sep}{year}'
        expected_date = f'{year}-{month:02d}-{day:02d}'
        if (i+j)%13==0: date,expected_date = f'{day}/{month}/…',None
        if (i+j)%17==0: date,expected_date = '',None
        place = '' if (i+j)%11==0 else rng.choice(PLACES)
        officiant = '' if (i+j)%10==0 else head()
        fields = [person,date,place,officiant]
        truth.append({'line': j+1, 'fields': fields, 'date':expected_date, 'readable':[bool(v) for v in fields]})
        lefts = xs[1:] if with_index else xs
        ink = (23,46,89) if quality == 'clear' else (21+rng.randint(0,40),45+rng.randint(0,36),76+rng.randint(0,33))
        if with_index: pen.text((xs[0]+13, ys[j+1]+19),str(j+1),font=label_font,fill=ink)
        for left,value in zip(lefts,fields):
            pen.text((left+rng.randint(11,19), ys[j+1]+rng.randint(15,24)),value,font=font,fill=ink)
    if quality == 'difficult':
        shadow = Image.new('RGB',paper.size,(136,148,169))
        mask=Image.new('L',paper.size)
        ImageDraw.Draw(mask).rectangle((0,0,430,1140),fill=60)
        paper = Image.composite(shadow,paper,mask.filter(ImageFilter.GaussianBlur(105)))
        paper = paper.rotate((-1 if i % 2 else 1)*(1.3+(i%4)*.35), resample=Image.Resampling.BICUBIC,fillcolor=(255,253,244))
        paper = paper.filter(ImageFilter.GaussianBlur(.48+(i%4)*.12))
    if i == 28: paper = paper.crop((0,0,1120,1140))
    if i == 29: paper = paper.filter(ImageFilter.GaussianBlur(22))
    if i == 31: paper = paper.crop((0,340,1660,850)).rotate(11,fillcolor=(255,253,244))
    stream=io.BytesIO()
    paper.save(stream,format='JPEG',quality=86 if quality=='difficult' else 93)
    raw=stream.getvalue()
    filename=f'p74-{i+1:02}.jpg'
    (output/filename).write_bytes(raw)
    return dict(image=filename,sha256=hashlib.sha256(raw).hexdigest(),font=writer,split=split,quality=quality,layout='stt' if with_index else 'four',rows=truth)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('fonts',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    manifest=[create_page(i,args.output,args.fonts) for i in range(32)]
    font_hashes={name:hashlib.sha256((args.fonts/(name+'.ttf')).read_bytes()).hexdigest()
                 for name in WRITERS['dev']+WRITERS['eval']}
    (args.output/'manifest.json').write_text(json.dumps({'fonts':font_hashes,'pages':manifest},ensure_ascii=False,indent=2)+'\n')
