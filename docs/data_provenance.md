# Data provenance, licences and transformations

Sources as recorded in the repository: `data/large/metadata/provenance.json`, `data/external/caravan/Caravan/licenses/README.md`, `data/augmented_v2/data_quality_report.json`.

## 1. USGS daily discharge (training target, test actuals, live gauges)
- **Source:** USGS National Water Information System, parameter 00060 (discharge), statistic 00003 (daily mean), in cfs.
- **Licence:** U.S. Government work, public domain.
- **Use:** training target, test actuals, live observations on the website.

## 2. Open-Meteo historical weather (precipitation, temperature, soil moisture)
- **Source:** Open-Meteo historical archive, "Best Match" (seamless ERA5, ERA5-Land and IFS).
- **Important:** this is **retrospective reanalysis**, not the operational forecast that was available at the time. Using it as model input is standard, but the reported test numbers do not measure real-time forecast skill with forecast weather.
- **Transformations:** daily weather and hourly soil moisture averaged by local day; soil moisture clipped to 0 to 1.
- **Licence:** Open-Meteo data under CC BY 4.0; the underlying ERA5 data under the Copernicus licence, which requires attribution.

## 3. Catchment attributes (drainage area, elevation, slope, forest cover, impervious cover)
- **Source:** USGS gauge metadata and catchment attribute files prepared for the project (`data/large/metadata/station_metadata.csv`, `catchment_attributes.csv`).
- **Missing values:** four attributes are missing for some stations (`provenance.json`: `missing_features: 4`). The model handles them.

## 4. Caravan US basins (data augmentation)
- **Source:** Caravan dataset (Kratzert et al.), 479 US basins, 1981-2014 streamflow with ERA5-Land weather.
- **Licence:** the data is **CC BY 4.0**; the code is BSD 3-Clause; ERA5-Land requires the Copernicus attribution statement; HydroATLAS attributes are CC BY 4.0. Cite Caravan and the source datasets in any publication.
- **Transformations:** streamflow mm/day to cfs using catchment area; basins that overlap the 55 gauges excluded; outliers and zero-run rows removed (`data/augmented_v2/data_quality_report.json`).

## 5. India: NWIC portal (live new-river test)
- **Source:** National Water Informatics Centre (nwdp.nwic.gov.in), CWC manual daily discharge in m3/s, via the public CKAN API.
- **Transformations:** m3/s converted to cfs (multiply by 35.3147). Used only for the live out-of-training test and the website, never for training.

## 6. Map and terrain (website only, not used by the model)
- **OpenStreetMap** river and water geometry: © OpenStreetMap contributors, ODbL. Map tiles: OpenMapTiles.
- **Terrain:** AWS Terrain Tiles (elevation), open data.
- **Geoapify** basemap: needs an API key, kept in `.env.local` (not in git).

## 7. GloFAS (comparison only)
- **Source:** Copernicus Global Flood Awareness System, via the Open-Meteo flood API. Shown on the website as a comparison line only.

## Limits
- The 2025 test set is public USGS data with retrospective weather. It is not the organisers' hidden test set, and its labels are not hidden from us.
- No restricted or confidential data is in the repository.
