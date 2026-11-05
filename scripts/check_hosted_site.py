"""Anonymous production checks for the Vercel site and its Render API proxy."""
import argparse
from html.parser import HTMLParser
import json
import math
from pathlib import Path
from urllib.parse import urljoin, urlencode
from urllib.request import Request, urlopen


def get(url):
    with urlopen(Request(url, headers={'User-Agent': 'FLOODCAST-deployment-check/1.0'}), timeout=120) as response:
        return response.status, response.headers.get_content_type(), response.read().decode('utf-8')


class ModuleScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'script' and attributes.get('type') == 'module' and attributes.get('src'):
            self.urls.append(attributes['src'])


def main(args):
    origin = args.frontend.rstrip('/')
    status, content_type, html = get(origin + '/')
    assert status == 200 and content_type == 'text/html' and 'FLOODCAST' in html
    parser = ModuleScripts()
    parser.feed(html)
    assert parser.urls, 'Missing frontend module bundle'
    bundles = [get(urljoin(origin, path))[2] for path in parser.urls]
    assert all(not bundle.lstrip().startswith('<!') for bundle in bundles), 'JS asset returned HTML'
    result = {'frontend': origin, 'anonymous_html_status': status, 'module_bundles': len(bundles)}
    if args.map_env_file:
        # Compare without putting the browser key in arguments, output, or reports.
        key = next(line.split('=', 1)[1].strip().strip('"\'') for line in Path(args.map_env_file).read_text(encoding='utf-8').splitlines()
                   if line.startswith('VITE_GEOAPIFY_API_KEY='))
        assert key and any(key in bundle for bundle in bundles), 'Map environment variable missing from build'
        result['geoapify_build_environment_verified'] = True
    status, content_type, body = get(origin + '/api/health')
    assert status == 200 and content_type == 'application/json', 'API rewrite did not return JSON'
    health = json.loads(body)
    assert health.get('ok') and health.get('stations') and health.get('horizons')
    result['api_proxy'] = {'status': status, 'model': health['model'], 'large_model': health.get('large_model'),
                           'station_count': len(health['stations']), 'capabilities': health.get('capabilities')}
    status, content_type, body = get(origin + '/reports/model/summary.json')
    assert status == 200 and isinstance(json.loads(body), dict), 'Saved report unavailable'
    result['saved_report_status'] = status
    status, content_type, body = get(origin + '/explorer/route-check')
    assert status == 200 and content_type == 'text/html' and 'FLOODCAST' in body
    result['spa_fallback_status'] = status
    if args.station:
        status, content_type, body = get(origin + '/api/live_forecast?' + urlencode({'station': args.station}))
        forecast = json.loads(body)
        assert status == 200 and forecast.get('horizons'), 'No live forecast'
        for horizon in forecast['horizons']:
            assert math.isfinite(horizon['point_cfs']) and horizon['point_cfs'] >= 0
            for name in ['p_high_flow', 'p_extreme_flow']:
                if horizon.get(name) is not None:
                    assert 0 <= horizon[name] <= 1
        result['live_forecast'] = {'status': status, 'station': args.station, 'model': forecast.get('model'),
                                   'origin_date': forecast.get('origin_date'),
                                   'horizons': [h['horizon_days'] for h in forecast['horizons']]}
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', required=True)
    parser.add_argument('--map-env-file')
    parser.add_argument('--station')
    parser.add_argument('--output')
    main(parser.parse_args())
