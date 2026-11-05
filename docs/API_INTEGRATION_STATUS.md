# API integration status

Last checked 2026-11-05 against `https://floodcast-api-ok9n.onrender.com` (Render, free plan) and `https://floodcast-hackoween.vercel.app` (Vercel).

## Endpoints

| Endpoint | Purpose | Status | Test that covers it |
|---|---|---|---|
| `GET /api/health` | model loaded, horizons, large-model cutoff | working (HTTP 200, loads `models_daily.joblib`, horizons 1, 3, 7) | `test_running_server_reports_the_shipped_models` (skipped when the server is down) |
| `GET /api/live_forecast?station=ID` | live forecast for a USGS gauge | working when the weather service is available; returned HTTP 502 once with the upstream rate-limit message | offline routing and forecast tests in `tests/test_api_integration.py` |
| `GET /api/live_forecast?india=KEY` | live forecast for an Indian NWIC gauge | working when the portal responds | `scripts/india_live_test.py` (results in `public/reports/model/india_live_test.json`) |
| `GET /api/live_forecast?lat=&lon=` | forecast for any river from GloFAS | working; new-river transfer test only | not in automated tests |
| `GET /api/run_test?dataset=caravan` | live test on random unseen Caravan basins | **disabled on the hosted site** (`caravan_live_test: false`), because the Caravan data is not deployed | `scripts/evaluate.py` runs the same test offline |

## Deployment
- Frontend: Vercel, built from `main` with `npm run build`; `vercel.json` proxies `/api/*` to the Render service.
- Backend: Render, Python web service from `render.yaml`, installs `requirements-render.txt`, starts `python -m server.model_api`, health check `/api/health`.
- Render's free plan sleeps when idle: the first request after a quiet period takes about 10 seconds.
- Environment: `VITE_GEOAPIFY_API_KEY` is set in hosting, not in git.

## Known limits
- Live forecasts call USGS, Open-Meteo and GloFAS. Their rate limits can make a request fail (HTTP 502 with the upstream message). The server reports the failure; it does not return a made-up number.
- Forecast weather for live use comes from Open-Meteo's forecast service, which is not the retrospective weather used in the reported evaluation.
- The hosted server does not include the Caravan dataset, so the random-basin test is off there.
