"""Reproducible PUBLIC-DATA DEMO, separate from the organizer's hidden test set."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import time
import threading
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import numpy as np
import pandas as pd

weather_lock=threading.Lock()
next_weather_request=0.

STATIONS = [
    ('01646500','Potomac River at Little Falls','Potomac',38.9498,-77.1276,'MD'),
    ('07010000','Mississippi River at St. Louis','Mississippi',38.6289,-90.1797,'MO'),
    ('08158000','Colorado River at Austin','Colorado',30.2447,-97.6947,'TX'),
    ('02087500','Neuse River near Clayton','Neuse',35.6472,-78.4056,'NC'),
    ('11425500','Sacramento River at Verona','Sacramento',38.774,-121.598,'CA'),
]
LARGE_SITE_IDS = ['01646500','07010000','08158000','02087500','11425500','01638500','01651000',
    '01491000','01463500','01470500','01570500','01578310','02035000','02037500','02084000',
    '02138500','02197000','02231000','02323500','02428400','02479000','03086000','03103000',
    '03303280','03339000','03353000','03451500','03611500','03612500','04024000','04193500',
    '04213500','05464500','05586100','06813500','06934500','07022000','07032000','07289000',
    '07374000','08067000','08170500','08313000','09380000','09402500','10109000','10311000',
    '11251000','11370500','12020000','12113000','12353000','12422500','14105700','14211720',
    '14246900','05054000','05114000']

def parse_rdb(text):
    lines=[line for line in text.splitlines() if not line.startswith('#')]
    return pd.read_csv(io.StringIO('\n'.join([lines[0]]+lines[2:])),sep='\t',dtype=str)

def discover_stations(args):
    query=urlencode({'format':'rdb','sites':','.join(LARGE_SITE_IDS),'siteOutput':'expanded'})
    sites=parse_rdb(fetch('https://waterservices.usgs.gov/nwis/site/?'+query,Path(args.output)/'raw'/'station_inventory.rdb'))
    sites=sites[sites.agency_cd=='USGS'].drop_duplicates('site_no')
    timezones={'EST':'America/New_York','CST':'America/Chicago','MST':'America/Denver','PST':'America/Los_Angeles',
              'AKST':'America/Anchorage','HST':'Pacific/Honolulu'}
    result=[]
    for _,s in sites.iterrows():
        if pd.isna(s.get('dec_lat_va')) or pd.isna(s.get('dec_long_va')): continue
        result.append((s.site_no,s.station_nm,s.station_nm,float(s.dec_lat_va),float(s.dec_long_va),
                       s.get('state_cd',''),timezones.get(s.get('tz_cd'),'America/New_York')))
    return result

def fetch(url, cache):
    global next_weather_request
    if cache.exists(): return cache.read_text(encoding='utf-8')
    for attempt in range(6):
        try:
            if 'archive-api.open-meteo.com' in url:
                # Long historical queries count as many API calls. Share a throttle across workers.
                with weather_lock:
                    time.sleep(max(0,next_weather_request-time.monotonic()))
                    next_weather_request=time.monotonic()+16
            with urlopen(Request(url, headers={'User-Agent':'FLOODCAST-hackathon/1.0'}), timeout=90) as response:
                text=response.read().decode('utf-8')
            cache.parent.mkdir(parents=True,exist_ok=True);cache.write_text(text,encoding='utf-8');return text
        except HTTPError as error:
            if error.code==429:
                detail=error.read().decode('utf-8',errors='replace')
                if 'daily' in detail.lower():raise RuntimeError(f'Daily provider quota reached: {detail}') from error
                delay=max(5,int(error.headers.get('Retry-After','60')))+2
                print(f'Provider rate limit; honoring Retry-After ({delay}s).',flush=True)
                if 'archive-api.open-meteo.com' in url:
                    with weather_lock:next_weather_request=max(next_weather_request,time.monotonic()+delay)
                else:time.sleep(delay)
                if attempt==5:raise
            elif attempt==5:raise
            else:time.sleep(2**attempt)
        except Exception:
            if attempt==5: raise
            time.sleep(2**attempt)

def station_data(station,args):
    sid,name,river,lat,lon,state=station[:6];cache=Path(args.output)/'raw'
    url='https://waterservices.usgs.gov/nwis/dv/?'+urlencode({'format':'json','sites':sid,'startDT':args.start,'endDT':args.end,'parameterCd':'00060','statCd':'00003'})
    discharge=json.loads(fetch(url,cache/f'{sid}-discharge-{args.start}-{args.end}.json'))
    rows=[]
    for series in discharge['value']['timeSeries']:
        for group in series['values']:
            for v in group['value']:
                if float(v['value'])>=0:
                    rows.append({'station_id':sid,'date':v['dateTime'][:10],'discharge_cfs':float(v['value'])})
    q=pd.DataFrame(rows,columns=['station_id','date','discharge_cfs']).drop_duplicates(['station_id','date'])
    if len(q)<100: raise ValueError(f'Insufficient actual USGS observations: {sid}')
    timezone=station[6] if len(station)>6 else {'MO':'America/Chicago','TX':'America/Chicago','CA':'America/Los_Angeles'}.get(state,'America/New_York')
    params={'latitude':lat,'longitude':lon,'start_date':args.start,'end_date':args.end,
            'daily':'precipitation_sum,temperature_2m_max,temperature_2m_min',
            'hourly':'soil_moisture_0_to_7cm','timezone':timezone}
    weather=json.loads(fetch('https://archive-api.open-meteo.com/v1/archive?'+urlencode(params),cache/f'{sid}-weather-local-{args.start}-{args.end}.json'))
    w=pd.DataFrame(weather['daily']).rename(columns={'time':'date','precipitation_sum':'precipitation_mm','temperature_2m_max':'temp_max_c','temperature_2m_min':'temp_min_c'})
    soil=pd.DataFrame(weather['hourly']);soil['date']=soil.time.str[:10]
    soil=soil.groupby('date',as_index=False).soil_moisture_0_to_7cm.mean().rename(columns={'soil_moisture_0_to_7cm':'soil_moisture'})
    # Drainage area is actual NWIS site metadata. Do not substitute gauge altitude for mean basin elevation.
    site_text=fetch('https://waterservices.usgs.gov/nwis/site/?'+urlencode({'format':'rdb','sites':sid,'siteOutput':'expanded'}),cache/f'{sid}-site.rdb')
    site=parse_rdb(site_text)
    drainage=pd.to_numeric(site.get('drain_area_va',pd.Series([np.nan])),errors='coerce').iloc[0]
    merged=q.merge(w,on='date',validate='one_to_one').merge(soil,on='date',validate='one_to_one')
    merged['drainage_area_sqmi']=drainage
    for column in ['mean_elevation_ft','slope_pct','forest_cover_pct']: merged[column]=np.nan
    print(f'{sid}: {len(merged)} observed daily targets, drainage={drainage} sq mi',flush=True)
    return merged,{'station_id':sid,'station_name':name,'river_name':river,'latitude':lat,'longitude':lon,'state':state}

def main(args):
    dest=Path(args.output);dest.mkdir(parents=True,exist_ok=True)
    stations=discover_stations(args) if args.large else STATIONS
    failures=[]
    def safely_download(station):
        try:return station_data(station,args)
        except Exception as error:
            if not args.large: raise
            failures.append({'station_id':station[0],'error':str(error)})
            print(f'SKIPPED {station[0]}: {error}',flush=True)
            return None
    with ThreadPoolExecutor(max_workers=3) as pool: results=[r for r in pool.map(safely_download,stations) if r is not None]
    if len(results)<2: raise ValueError('Need at least two stations with real observations')
    frame=pd.concat([r[0] for r in results],ignore_index=True).sort_values(['date','station_id'])
    train=frame[frame.date<args.test_start]; test=frame[frame.date>=args.test_start]
    if train.empty or test.empty:raise ValueError('Date split produced an empty dataset')
    train.to_csv(dest/'train.csv',index=False);test.drop(columns='discharge_cfs').to_csv(dest/'test.csv',index=False)
    test[['station_id','date','discharge_cfs']].to_csv(dest/'demo_holdout_actuals.csv',index=False)
    pd.DataFrame([r[1] for r in results]).to_csv(dest/'station_metadata.csv',index=False)
    manifest={'purpose':'Public-data demo only. Not official event train/test data.',
              'target':'USGS 00060, statistic 00003: DAILY MEAN discharge in cfs, not instantaneous daily peak.',
              'period':[args.start,args.end],'test_start':args.test_start,'stations':[r[1]['station_id'] for r in results],
              'requested_station_count':len(stations),'skipped_stations':failures,
              'train_rows':len(train),'test_rows':len(test),
              'missing_features':['mean_elevation_ft','slope_pct','forest_cover_pct'],
              'weather':'Open-Meteo Best Match historical archive (seamless ERA5/ERA5-Land/IFS); daily weather and hourly soil moisture averaged by local day. Same-day reanalysis is retrospective, not operational forecast data.',
              'timezone':'Station-local time zone derived from NWIS tz_cd for large downloads; local zones for the five-station demo. DST boundaries may differ from USGS fixed standard-time reporting.',
              'station_substitution':'11447650 (Freeport) had no daily 00060 observations in the requested period; using 11425500 (Sacramento at Verona) instead.',
              'sources':['https://waterservices.usgs.gov/','https://open-meteo.com/en/docs/historical-weather-api'],
              'note':'Download cache preserves raw responses and USGS quality flags. Demo includes provisional observations if supplied; review flags before official use. StreamStats attributes require a delineated workspace and are left missing, never fabricated.'}
    (dest/'provenance.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps(manifest,indent=2),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start',default='2021-01-01');parser.add_argument('--end',default='2024-12-31')
    parser.add_argument('--test-start',default='2024-07-01');parser.add_argument('--output',default='data/demo')
    parser.add_argument('--large',action='store_true',help='Discover metadata and download up to 58 real USGS stations. Specify a longer --start/--end period explicitly.')
    main(parser.parse_args())
