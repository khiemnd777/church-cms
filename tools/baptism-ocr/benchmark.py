"""Measure the local engine before human review; use the deny-network launcher."""

import argparse
import datetime
import json
import math
import re
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

from worker import MODEL_PAIRS, make_engine, read_page


def normalize(s):
    return ' '.join(unicodedata.normalize('NFC',s).lower().split())


def normalize_date(s):
    match = re.fullmatch(r'(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})',s.strip())
    if not match:
        return None
    d,m,y=map(int,match.groups())
    try: return datetime.date(y,m,d).isoformat()
    except ValueError: return None


def run(args):
    pages=json.loads((args.corpus/'manifest.json').read_text())['pages']
    start=time.monotonic()
    engine=make_engine(str(args.models),args.family)
    cold=time.monotonic()-start
    result=[]
    for page in pages:
        if page['split'] != args.split:
            continue
        ocr=read_page(engine,(args.corpus/page['image']).read_bytes())
        result.append(dict(page=page['image'],quality=page['quality'],**ocr))
    by_image={p['image']:p for p in pages}
    groups=defaultdict(lambda: defaultdict(lambda:[0,0]))
    adverse=[]
    times=[]
    for item in result:
        if item['quality']=='adverse':
            adverse.append(dict(page=item['page'],handled=item['status']=='layout'))
            continue
        times.append(item['elapsed'])
        gt=by_image[item['page']]['rows']
        detected=item['rows']
        for group in ['all',item['quality']]:
            metrics=groups[group]
            metrics['extra_rows'][0]+=max(0,len(detected)-len(gt))
            for i,labeled in enumerate(gt):
                cells=detected[i] if len(detected)==len(gt) else []
                correct=bool(cells and cells[0]['text'])
                metrics['row'][1]+=1
                metrics['row'][0]+=correct
                for j,key in enumerate(['name','date','place','officiant']):
                    expected=labeled['date'] if key=='date' else normalize(labeled['fields'][j])
                    if not expected:
                        continue
                    guess=cells[j]['text'] if cells else ''
                    actual=normalize_date(guess) if key=='date' else normalize(guess)
                    metrics[key][1]+=1
                    metrics[key][0]+=actual==expected
    p95=sorted(times)[math.ceil(.95*len(times))-1]
    thresholds=dict(row=.95,name=.85,date=.90,place=.75,officiant=.75)
    totals={g:{k:{'correct':a,'total':b,'ratio':a/b if b else None} for k,(a,b) in metrics.items()} for g,metrics in groups.items()}
    passed=all(totals['all'][k]['ratio']>=v for k,v in thresholds.items()) and p95<=15
    if args.split=='eval':
        passed=passed and len(adverse)==4 and all(a['handled'] for a in adverse)
    report=dict(family=args.family,split=args.split,passed=passed,cold=cold,p95=p95,totals=totals,adverse=adverse,pages=result)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='pages'},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('models',type=Path)
    parser.add_argument('corpus',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--split',choices=['dev','eval'],default='dev')
    parser.add_argument('--family',choices=MODEL_PAIRS,default='v6')
    run(parser.parse_args())
