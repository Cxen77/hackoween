# context/ — reference material for future agents

Source briefs/specs that drive modeling decisions. Read alongside HANDOFF.md.

- BASINSHIFT_Full_Challenge_Documentation.pdf (+ .txt extract): organizer spec (v1.0 draft, 3 Nov 2026).

## Key takeaways from BASINSHIFT (vs the FLOODCAST brief the current model targets)
- Task: forecast discharge at horizons (provisional 1/3/7 d) AND high-flow / extreme exceedance probabilities AND uncertainty intervals, on UNSEEN catchments (Caravan dataset, ~6,830 basins).
- Inputs explicitly PERMIT past observed discharge history + quality flags (available at forecast origin) -> lagged-discharge / persistence-style features are legal here. The FLOODCAST model currently forbids them; this is likely the largest accuracy lever if BASINSHIFT is the target.
- Splits: train / validation / Test A temporal / Test B unseen catchments / Test C stress (missing, noisy, delayed inputs). Catchment split before windowing.
- Score weights: forecast skill 25, high-flow detection 25 (AUPRC, recall at alert budget), OOD generalization 20 (macro per catchment), calibration 15 (Brier/CRPS/coverage), robustness 10, efficiency 5.
- Baselines required: persistence, seasonal/climatology, gradient boosting, sequence model.
- Rules: fit scalers on train only; thresholds from a reference period only; declare external data; no manual edits; never fill missing discharge with zero; UTC.
- Judging: ML perf 20, novelty 15, architecture 10, robustness 15, applicability 10, reproducibility 15, defense 5, uncertainty/responsible AI 10.
- Out of scope: street-level inundation, certified warnings.

## FLOODCAST_Participant_PS_Updated.pdf (+ .txt extract) — the hackathon problem statement (v1.0, Nov 2026)
- Task: predict peak daily discharge_cfs (non-negative) for each (station_id, date) in test.csv. Test dates strictly after train dates.
- Inputs: precipitation_mm, temp_max_c, temp_min_c, soil_moisture, drainage_area_sqmi, mean_elevation_ft, slope_pct, forest_cover_pct. Discharge history is NOT listed as a test input.
- Score: RMSE overall 40%, RMSE top-10% discharge days 30%, MAE 20%, R2 10%. Ranking uses raw RMSE during event.
- Output: predictions.csv with exactly station_id,date,discharge_cfs, UTF-8, one row per test record.
- Deliverables: public GitHub repo, README.md, requirements.txt, solution.py/ipynb, predictions.csv, model_card.md, 3–5 slide presentation. Deadline hour 20.
- APIs named: USGS waterservices (dv, 00060), Open-Meteo archive, USGS StreamStats. All already implemented in scripts/download_data.py (USGS dv + Open-Meteo archive, with local cache) and scripts/download_catchments.py (StreamStats gagestatsservices endpoint, not the older streamstatsservices/characteristics.json path in the PDF).
- Open point: the PDF's rules forbid discharge history as an input for the test; the BASINSHIFT spec allows it. Confirm which rules apply.
