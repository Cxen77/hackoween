"""Download actual StreamStats Gage Statistics basin characteristics. Never use flow statistics."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
from io import BytesIO
from zipfile import ZipFile
from urllib.request import Request, urlopen
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parent))
from download_data import fetch, parse_rdb

FIELDS=['drainage_area_sqmi','mean_elevation_ft','slope_pct','forest_cover_pct','impervious_surface_pct']

def gages_attributes(root):
    """Use only static, pre-target basin descriptors from the USGS GAGES-II bulk release."""
    archive=root/'raw'/'gagesii.zip'
    url='https://water.usgs.gov/GIS/dsdl/basinchar_and_report_sept_2011.zip'
    if not archive.exists():
        with urlopen(Request(url,headers={'User-Agent':'FLOODCAST-hackathon/1.0'}),timeout=120) as response:
            archive.write_bytes(response.read())
    with ZipFile(archive) as outer:
        with ZipFile(BytesIO(outer.read('spreadsheets-in-csv-format.zip'))) as inner:
            read=lambda name:pd.read_csv(BytesIO(inner.read(name)),encoding='latin1',dtype={'STAID':str}).set_index('STAID')
            # Do not load climate/discharge/flow-record summary files from the archive.
            basin=read('conterm_basinid.txt');topo=read('conterm_topo.txt')
            cover=read('conterm_lc06_basin.txt');impervious=read('conterm_pop_infrastr.txt')
    result=pd.DataFrame(index=basin.index)
    result['drainage_area_sqmi']=pd.to_numeric(basin.DRAIN_SQKM,errors='coerce')/2.589988110336
    result['mean_elevation_ft']=pd.to_numeric(topo.ELEV_MEAN_M_BASIN,errors='coerce')*3.280839895
    result['slope_pct']=pd.to_numeric(topo.SLOPE_PCT,errors='coerce')
    result['forest_cover_pct']=pd.to_numeric(cover.FORESTNLCD06,errors='coerce')
    result['impervious_surface_pct']=pd.to_numeric(impervious.IMPNLCD06,errors='coerce')
    result=result.where(result>=0)
    return result,url

def normalize(characteristic):
    variable=characteristic.get('variableType',{})
    code=variable.get('code','').upper()
    unit=characteristic.get('unitType',{}).get('abbreviation','').lower()
    value=characteristic.get('value')
    if value is None or not np.isfinite(float(value)) or float(value)<0:return None
    value=float(value)
    if code=='DRNAREA':
        if unit in ['mi^2','mi2']:return 'drainage_area_sqmi',value
        if unit in ['km^2','km2']:return 'drainage_area_sqmi',value/2.589988110336
    if code=='ELEV':
        if unit in ['ft','feet']:return 'mean_elevation_ft',value
        if unit in ['m','meters']:return 'mean_elevation_ft',value*3.280839895
    if code in ['FOREST','LC11FOREST','LC16FOREST','LC19FOREST','LC21FOREST'] and unit=='%' and value<=100:
        return 'forest_cover_pct',value
    if code in ['IMPERV','LC11IMP','LC16IMP','LC19IMP','LC21IMP'] and unit=='%' and value<=100:
        return 'impervious_surface_pct',value
    # Do not silently confuse channel slope (ft/mile), slope angle, fraction, and basin percent slope.
    if code in ['SLOPE_PCT','BSLOPE','BSLOPD','BSLOPGM','BASINSLOPE','BSLDEM30M','BSLDEM10M','BSLDEM3M']:
        if unit in ['%','percent'] and value<=100:return 'slope_pct',value
        if unit in ['degrees','deg','°'] and value<90:return 'slope_pct',float(np.tan(np.deg2rad(value))*100)
        if unit in ['ft/ft','m/m'] and value<=1:return 'slope_pct',value*100
    return None

def main(args):
    root=Path(args.data)
    if getattr(args,'inventory',False):
        inventory=parse_rdb((root/'raw'/'station_inventory.rdb').read_text(encoding='utf-8'))
        metadata=inventory[inventory.agency_cd=='USGS'].drop_duplicates('site_no').rename(columns={'site_no':'station_id'})
    else:metadata=pd.read_csv(root/'station_metadata.csv',dtype={'station_id':str})
    errors=[];sources=[]
    def one(sid):
        row={'station_id':sid,**{k:np.nan for k in FIELDS}}
        url=f'https://streamstats.usgs.gov/gagestatsservices/stations/{sid}?include=characteristics'
        try:
            data=json.loads(fetch(url,root/'raw'/f'{sid}-streamstats.json'))
            # Explicit allowlist: data['statistics'] contains discharge-derived summaries and is NEVER read.
            chars=sorted(data.get('characteristics',[]),key=lambda c:(bool(c.get('isPreferred')),c.get('id',0)))
            for c in chars:
                match=normalize(c)
                if match:
                    key,value=match;row[key]=value
                    sources.append({'station_id':sid,'field':key,'value':value,'source_variable':c['variableType']['code'],
                                    'source_unit':c.get('unitType',{}).get('abbreviation'),
                                    'citation':c.get('citation',{}),'url':url})
            print(f'{sid}: '+', '.join(f'{k}={v:.2f}' for k,v in row.items() if k!='station_id' and pd.notna(v)),flush=True)
        except Exception as error:
            errors.append({'station_id':sid,'error':str(error)});print(f'{sid}: attributes unavailable ({error})',flush=True)
        return row
    with ThreadPoolExecutor(max_workers=3) as pool: rows=list(pool.map(one,metadata.station_id))
    attributes=pd.DataFrame(rows)
    streamstats_coverage={f:int(attributes[f].notna().sum()) for f in FIELDS}
    supplemental_error=None
    try:
        gages,url=gages_attributes(root)
        columns={'drainage_area_sqmi':('DRAIN_SQKM','km² → mi²'),
                 'mean_elevation_ft':('ELEV_MEAN_M_BASIN','m → ft'),'slope_pct':('SLOPE_PCT','%'),
                 'forest_cover_pct':('FORESTNLCD06','%'),'impervious_surface_pct':('IMPNLCD06','%')}
        for field in FIELDS:
            supplemental=attributes.station_id.map(gages[field])
            use=attributes[field].isna() & supplemental.notna()
            for _,r in attributes[use].iterrows():
                value=float(gages.loc[r.station_id,field])
                sources.append({'station_id':r.station_id,'field':field,'value':value,
                                'source_variable':columns[field][0],'source_unit':columns[field][1],
                                'citation':{'title':'Falcone (2011), GAGES-II: Geospatial attributes of gages for evaluating streamflow',
                                            'citationURL':'https://doi.org/10.5066/P96CPHOT'},'url':url})
            attributes[field]=attributes[field].combine_first(supplemental)
    except Exception as error:
        supplemental_error=str(error);print(f'GAGES-II supplement unavailable: {error}',flush=True)
    attributes.to_csv(root/'catchment_attributes.csv',index=False)
    for filename in ['train.csv','test.csv']:
        frame=pd.read_csv(root/filename,dtype={'station_id':str})
        for field in FIELDS:
            actual=frame.station_id.map(attributes.set_index('station_id')[field])
            previous=frame[field] if field in frame else pd.Series(np.nan,index=frame.index)
            frame[field]=actual.combine_first(previous)
        frame.to_csv(root/filename,index=False)
    provenance={'source':'USGS StreamStats Gage Statistics Services, supplemented with actual static USGS GAGES-II basin attributes',
                'endpoint':'https://streamstats.usgs.gov/gagestatsservices/stations/{station_id}?include=characteristics',
                'policy':'Explicit static-characteristic allowlist; no streamflow statistics or target-derived quantiles are used. Conflicting units/definitions remain missing.',
                'coverage_stations':{f:int(attributes[f].notna().sum()) for f in FIELDS},
                'streamstats_coverage_stations':streamstats_coverage,'gagesii_supplement_error':supplemental_error,
                'total_stations':len(attributes),'errors':errors,'source_values':sources}
    (root/'catchment_provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf-8')
    print('Coverage:',json.dumps(provenance['coverage_stations']),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--data',default='data/large')
    parser.add_argument('--inventory',action='store_true',help='Prefetch characteristics for every station in the cached NWIS inventory')
    main(parser.parse_args())
