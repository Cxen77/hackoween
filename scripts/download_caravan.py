"""Download the US (CAMELS) part of the Caravan dataset without fetching the whole 12.5 GB archive.

Caravan v1.2 (CC-BY 4.0): https://doi.org/10.5281/zenodo.7944025. Only the US basins and their attribute tables are
extracted (about 480 MB compressed, ~1.5 GB on disk) into data/external/caravan/ using HTTP range requests.
This folder is NOT stored in Git; run this script on a new machine to recreate it. Needs: pip install remotezip

Usage: python -m scripts.download_caravan
"""
from __future__ import annotations

from pathlib import Path

from remotezip import RemoteZip

URL = 'https://zenodo.org/records/7944025/files/Caravan.zip?download=1'
OUT = Path('data/external/caravan')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with RemoteZip(URL) as z:
        names = [i.filename for i in z.infolist() if not i.filename.endswith('/') and
                 ('timeseries/csv/camels/' in i.filename or 'attributes/camels/' in i.filename or i.filename.endswith(('README.md', 'license.md', 'LICENSE.md')))]
        todo = [n for n in names if not (OUT / n).exists()]
        print(f'{len(names)} files needed, {len(todo)} to download', flush=True)
        for k, n in enumerate(todo):
            z.extract(n, OUT)
            if k % 50 == 0:
                print(f'  {k}/{len(todo)}', flush=True)
    print('Caravan US subset ready in', OUT)


if __name__ == '__main__':
    main()
