"""The shipped model artifacts exist, match the manifest checksums and load with the expected horizons."""
import hashlib
import json
import unittest
from pathlib import Path

import joblib

MODELS = Path('models')


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ModelArtifacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((MODELS / 'manifest.json').read_text(encoding='utf-8'))

    def test_every_manifest_file_exists_and_matches_its_checksum(self):
        for art in self.manifest['artifacts']:
            path = MODELS / art['file']
            self.assertTrue(path.exists(), art['file'])
            self.assertEqual(sha256(path), art['sha256'], f'checksum mismatch: {art["file"]}')

    def test_forecast_models_load_with_1_3_7_day_horizons(self):
        for name in ('models_daily.joblib', 'models_large.joblib'):
            obj = joblib.load(MODELS / name)
            self.assertEqual(sorted(obj['bundle']['horizons']), [1, 3, 7], name)
            # The reference cut is the year before which thresholds were learned. The daily model uses 2000; the
            # large-river model was trained on the held-out experiment with 2022 (see docs/VALIDATION_PROTOCOL.md).
            self.assertEqual(obj['fit_ref_cut'], {'models_daily.joblib': '2000-01-01', 'models_large.joblib': '2022-01-01'}[name], name)

    def test_threshold_file_covers_the_55_training_gauges(self):
        meta = json.loads((MODELS / 'model_meta.json').read_text(encoding='utf-8'))
        self.assertEqual(len(meta['thresholds']), 55)
        for sid, t in meta['thresholds'].items():
            self.assertLess(t['T90'], t['T99'], sid)


if __name__ == '__main__':
    unittest.main()
