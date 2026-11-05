"""Independent check of the FLOODCAST scores, using only pandas and numpy.

Run from the project root:  python test/score_check.py
It reads predictions.csv and actuals.csv in this folder and prints RMSE, extreme RMSE, MAE and R2.
Expected for the full files: RMSE 46,543 | extreme RMSE 111,777 | MAE 14,003 | R2 0.9149.
"""
from pathlib import Path

import numpy as np
import pandas as pd

here = Path(__file__).parent
pred = pd.read_csv(here / 'predictions.csv', dtype={'station_id': str})
act = pd.read_csv(here / 'actuals.csv', dtype={'station_id': str})
m = act.merge(pred, on=['station_id', 'date'], suffixes=('_actual', '_pred'))
y, p = m.discharge_cfs_actual.to_numpy(float), m.discharge_cfs_pred.to_numpy(float)
top = m.groupby('station_id').discharge_cfs_actual.transform(lambda s: s.quantile(0.9)) <= m.discharge_cfs_actual
err = y - p
rmse = np.sqrt(np.mean(err ** 2))
extreme = np.sqrt(np.mean(err[top] ** 2))
mae = np.mean(np.abs(err))
r2 = 1 - np.sum(err ** 2) / np.sum((y - y.mean()) ** 2)
print(f'rows {len(m):,}')
print(f'RMSE {rmse:,.0f} | extreme RMSE {extreme:,.0f} | MAE {mae:,.0f} | R2 {r2:.4f}')
