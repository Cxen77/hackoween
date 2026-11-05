"""The model server's routing and forecast code, run on the shipped models with no internet access.

Live endpoints call USGS and Open-Meteo, so they are not tested here. The offline checks below use the same code the
server runs. If a server is already running on 127.0.0.1:8765, its health endpoint is also checked.
"""
import json
import unittest
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'models'
EXAMPLE = ROOT / 'test' / 'example_history.csv'


class ApiIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import server.model_api as api
        api.load_state(MODELS / 'models_daily.joblib', ROOT / 'data/large/train/train.csv', ROOT / 'data/large/metadata/station_metadata.csv')
        cls.api = api
        cls.example = pd.read_csv(EXAMPLE, dtype={'station_id': str})

    def test_large_rivers_route_to_the_large_model_and_others_to_the_daily_model(self):
        big = self.example[self.example.station_id == '07010000']   # Mississippi at St. Louis, 697,000 sq mi
        small = self.example[self.example.station_id == '01491000'] # Choptank River, 116 sq mi
        _, name_big = self.api.pick_bundle(big)
        _, name_small = self.api.pick_bundle(small)
        self.assertEqual(name_big, 'models_large.joblib')
        self.assertEqual(name_small, 'models_daily.joblib')

    def test_routed_forecast_returns_every_horizon_with_finite_values(self):
        for sid, frame in self.example.groupby('station_id'):
            frame = frame.sort_values('date').reset_index(drop=True)
            for h in (1, 3, 7):
                o = self.api.routed_forecast(frame, '2000-01-01', h)
                i = int(frame.index[frame.date == frame.date.max()][0])
                self.assertTrue(pd.notna(o['point'][i]), (sid, h))
                self.assertTrue(o['point'][i] >= 0, (sid, h))

    def test_running_server_reports_the_shipped_models(self):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=3) as r:
                health = json.loads(r.read())
        except OSError:
            self.skipTest('model server not running on 127.0.0.1:8765')
        self.assertTrue(health['ok'])
        self.assertEqual(health['horizons'], [1, 3, 7])


if __name__ == '__main__':
    unittest.main()
