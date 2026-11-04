"""Download the US (CAMELS) part of the Caravan dataset without fetching the whole 12.5 GB archive.

Caravan v1.2 (CC-BY 4.0): https://doi.org/10.5281/zenodo.7944025. Only the US basins and their attribute tables are
extracted (about 480 MB compressed, ~1.5 GB on disk) into data/external/caravan/ using HTTP range requests.
This folder is NOT stored in Git; run this script on a new machine to recreate it. Needs: pip install remotezip

Usage: python -m scripts.download_caravan
"""
from __future__ import annotations

import time
from pathlib import Path

import requests
from remotezip import RemoteZip

URL = 'https://zenodo.org/records/7944025/files/Caravan.zip?download=1'
OUT = Path('data/external/caravan')


def get_remote_zip() -> RemoteZip:
    sess = requests.Session()
    sess.headers.update({'User-Agent': 'curl/8.4.0'})
    return RemoteZip(URL, session=sess)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print('Connecting to Zenodo Caravan archive...', flush=True)
    z = get_remote_zip()
    names = [i.filename for i in z.infolist() if not i.filename.endswith('/') and
             ('timeseries/csv/camels/' in i.filename or 'attributes/camels/' in i.filename or i.filename.endswith(('README.md', 'license.md', 'LICENSE.md')))]
    
    todo = [n for n in names if not ((OUT / n).exists() and (OUT / n).stat().st_size > 0)]
    print(f'{len(names)} files needed, {len(todo)} to download ({len(names) - len(todo)} already present)', flush=True)

    t0 = time.time()
    for k, n in enumerate(todo):
        target = OUT / n
        if target.exists() and target.stat().st_size > 0:
            continue
        for attempt in range(5):
            try:
                z.extract(n, OUT)
                break
            except Exception as e:
                print(f'  [retry {attempt + 1}/5] {type(e).__name__} on {Path(n).name}: {e}. Reconnecting...', flush=True)
                time.sleep(2 * (attempt + 1))
                try:
                    z.close()
                except Exception:
                    pass
                z = get_remote_zip()
        
        if (k + 1) % 25 == 0 or (k + 1) == len(todo):
            elapsed = time.time() - t0
            rate = (k + 1) / max(elapsed, 1)
            remaining = (len(todo) - (k + 1)) / max(rate, 0.01)
            print(f'  [{k + 1}/{len(todo)}] ({((k + 1)/len(todo))*100:.1f}%) - {rate:.1f} files/s - ~{remaining/60:.1f} min remaining', flush=True)

    try:
        z.close()
    except Exception:
        pass
    print('Caravan US subset ready in', OUT, flush=True)


if __name__ == '__main__':
    main()
