import json
import unittest
from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from qualify import as_date, freeze, matched, score_page, summary, validate_independent
from vietnamese import ACCENTED, ALPHABET, decode, prepare


class RecognitionTest(unittest.TestCase):
    def test_ctc_preserves_distinct_vietnamese_tones(self):
        self.assertTrue(set(ACCENTED + ACCENTED.upper()) <= set(ALPHABET))
        token_list = ['T', 'ú', 'ú', '', ' ', 'T', 'ụ', 'ụ', '', ' ', 'T', 'ự']
        logits = np.full((1, len(token_list), len(ALPHABET) + 1), -10, dtype=np.float32)
        for index, token in enumerate(token_list):
            logits[0, index, ALPHABET.index(token) + 1 if token else 0] = 10
        self.assertEqual(list(decode(logits, ALPHABET))[0]['rec_text'], 'Tú Tụ Tự')

    def test_blank_image_has_no_ink(self):
        pale = np.full((120, 370), 242, np.uint8)
        pale[12, 5] = 225
        self.assertEqual(np.count_nonzero(prepare(pale)), 0)


class QualificationTest(unittest.TestCase):
    def test_date_matches_existing_day_first_formats(self):
        for text in ('19/11/2026', '19.11.2026', '19-11-2026', 'Ngày 19 tháng 11 năm 2026'):
            self.assertEqual(as_date(text), '2026-11-19')
        self.assertIsNone(as_date('31/11/2026'))
        self.assertIsNone(as_date('19/11/…'))

    def test_matching_rejects_an_extra_row_without_shifting_later_rows(self):
        rows = [{'y': y} for y in (.2, .3, .4)]
        result = {'row_centers': [.2, .25, .4], 'rows': [[], [], []]}
        self.assertEqual(matched(rows, result), [0, None, 2])

    def test_scoring_flags_wrong_accent_filled_blank_and_invented_date(self):
        page = {'rows': [
            {'y': .2, 'fields': ['Tú', '1/2/2005', '', ''], 'date': '2005-02-01'},
            {'y': .3, 'fields': ['Tụ', '1/2/…', '', ''], 'date': None},
        ]}
        decoded = [['Tu', '', 'Huế', ''], ['Tụ', '1/2/2005', '', '']]
        result = {'row_centers': [.2, .3], 'rows': [[{'text': text, 'score': .9} for text in row] for row in decoded]}
        metrics = Counter()
        score_page(page, result, metrics)
        results = summary(metrics)
        self.assertEqual(results['name']['correct'], 1)
        self.assertEqual(results['name']['wrong'], 1)
        self.assertEqual(results['date']['missing'], 1)
        self.assertEqual(results['date']['false_date'], 1)
        self.assertEqual(results['place']['false_value'], 1)
        self.assertEqual(results['row']['review'], 2)

    def test_independent_mode_rejects_an_incomplete_corpus_before_reading_images(self):
        with self.assertRaisesRegex(ValueError, '28 distinct images'):
            validate_independent([], None)

    def test_freeze_needs_passing_development_for_the_exact_artifacts(self):
        with TemporaryDirectory() as folder, patch('qualify.inputs', return_value={'family': 'vi'}):
            root = Path(folder)
            source = root / 'dev.json'
            destination = root / 'freeze.json'
            args = SimpleNamespace(development=source, models=root, family='vi', output=destination)
            for passed, family in [(False, 'vi'), (True, 'v6')]:
                source.write_text(json.dumps(dict(mode='dev', passed=passed, identity={'family': family})))
                with self.assertRaisesRegex(ValueError, 'Development gate'):
                    freeze(args)
                self.assertFalse(destination.exists())
            source.write_text(json.dumps(dict(mode='dev', passed=True, identity={'family': 'vi'})))
            freeze(args)
            self.assertEqual(json.loads(destination.read_text()), {'family': 'vi'})


if __name__ == '__main__':
    unittest.main()
