"""Write models/manifest.json: artifact name, purpose, size and SHA-256, so anyone can verify the files they downloaded.

Usage: python -m scripts.write_manifest
"""
import hashlib
import json
from pathlib import Path

import joblib

MODELS = Path('models')
PURPOSE = {
    'models_daily.joblib': 'Forecast model for rivers under 10,000 sq mi (trained on 55 USGS gauges + 479 Caravan basins, tuned). Held-out version: trained without the 11 test gauges and 60 test basins.',
    'models_large.joblib': 'Forecast model for rivers of 10,000 sq mi or more (trained on the 55 USGS gauges). Held-out version: trained without the 11 test gauges.',
    'model_meta.json': 'Per-gauge Q90/Q99 thresholds, static catchment facts and gauge names used at inference for the 55 training gauges.',
    'holdout_ids.json': 'Exact list of the 11 held-out USGS gauges and 60 held-out Caravan basins that the served models never saw.',
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    entries = []
    for name in sorted(PURPOSE):
        p = MODELS / name
        entry = {'file': name, 'purpose': PURPOSE[name], 'bytes': p.stat().st_size, 'sha256': sha256(p)}
        if name.endswith('.joblib'):
            obj = joblib.load(p)
            entry['horizons_days'] = sorted(obj['bundle']['horizons'])
            entry['fit_reference_cut'] = obj['fit_ref_cut']
            entry['library'] = 'lightgbm'
        entries.append(entry)
    manifest = {'project': 'FLOODCAST / BASINSHIFT', 'version': '2026-11-05', 'artifacts': entries}
    (MODELS / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'wrote {MODELS / "manifest.json"} with {len(entries)} artifacts')


if __name__ == '__main__':
    main()
