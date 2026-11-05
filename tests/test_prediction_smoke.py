"""End-to-end smoke test: scripts/predict.py on the example history produces valid forecasts."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / 'test' / 'example_history.csv'


class PredictionSmoke(unittest.TestCase):
    def test_predict_writes_valid_forecasts_for_every_station(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'forecasts.csv'
            subprocess.run([sys.executable, '-m', 'scripts.predict', '--input', str(EXAMPLE), '--output', str(out)],
                           cwd=ROOT, check=True, capture_output=True)
            f = pd.read_csv(out, dtype={'station_id': str})
        self.assertEqual(len(f), 12)                      # 4 stations x horizons 1, 3, 7
        self.assertEqual(sorted(f.horizon_days.unique()), [1, 3, 7])
        self.assertEqual(f.station_id.nunique(), 4)
        self.assertTrue(f.point_cfs.notna().all())
        self.assertTrue((f.point_cfs >= 0).all())
        self.assertTrue(f.p_high_flow.between(0, 1).all())
        self.assertTrue(f.p_extreme_flow.between(0, 1).all())
        ok = f.lo_cfs.notna()
        self.assertTrue((f.lo_cfs[ok] <= f.point_cfs[ok] + 1e-6).all())
        self.assertTrue((f.point_cfs[ok] <= f.hi_cfs[ok] + 1e-6).all())
        self.assertEqual(set(f.target_date.str[:7]), {'2024-12'})


if __name__ == '__main__':
    unittest.main()
