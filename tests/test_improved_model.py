import unittest
import numpy as np
import pandas as pd
from solution import FEATURES
from scripts.improve_model import improved_features,regional_features,peak_weights
from scripts.regime_ensemble import combine

class ImprovedFeaturesTests(unittest.TestCase):
    def data(self):
        return pd.DataFrame({'station_id':['a']*4,'date':['2020-01-01','2020-01-02','2020-01-04','2020-01-05'],
            **{name:[1.,2.,3.,4.] for name in FEATURES},'discharge_cfs':[10.,20.,30.,100.]})

    def test_long_history_excludes_current_and_future_weather(self):
        frame=self.data();metadata=pd.DataFrame({'station_id':['a'],'latitude':[40.],'longitude':[-77.]})
        x=improved_features(frame,metadata)
        self.assertTrue(np.isnan(x.rain_previous_90d.iloc[0]))
        self.assertEqual(x.rain_previous_90d.iloc[2],3.)
        frame.loc[3,'precipitation_mm']=1e9
        changed=improved_features(frame,metadata)
        self.assertEqual(changed.rain_previous_90d.iloc[3],x.rain_previous_90d.iloc[3])
        self.assertEqual(changed.rain_previous_90d.iloc[2],x.rain_previous_90d.iloc[2])

    def test_target_changes_do_not_change_any_input(self):
        frame=self.data();metadata=pd.DataFrame({'station_id':['a'],'latitude':[40.],'longitude':[-77.]})
        expected=improved_features(frame,metadata)
        frame['discharge_cfs']=[9e8]*4
        pd.testing.assert_frame_equal(expected,improved_features(frame,metadata))

    def test_missing_geography_is_not_fabricated(self):
        x=improved_features(self.data(),pd.DataFrame(columns=['station_id']))
        self.assertTrue(x.latitude.isna().all());self.assertTrue(x.longitude.isna().all())

    def test_peak_weights_are_station_specific(self):
        frame=self.data();weights=peak_weights(frame)
        np.testing.assert_array_equal(weights,[1.,1.,1.,3.])

    def test_regional_proxy_uses_weather_only_and_lags_are_causal(self):
        frame=pd.concat([self.data().iloc[:2],self.data().iloc[:2].assign(station_id='b',precipitation_mm=[10.,20.])],ignore_index=True)
        metadata=pd.DataFrame({'station_id':['a','b'],'huc2':['08','07']})
        result=regional_features(frame,metadata)
        self.assertEqual(result.regional_rain_previous_7d.iloc[1],5.5)
        frame['discharge_cfs']=9e10
        pd.testing.assert_frame_equal(result,regional_features(frame,metadata))
        frame.loc[1,'precipitation_mm']=1e8
        self.assertEqual(regional_features(frame,metadata).regional_rain_previous_7d.iloc[1],5.5)

    def test_unknown_region_does_not_invent_a_global_basin(self):
        result=regional_features(self.data(),pd.DataFrame(columns=['station_id']))
        self.assertTrue(result.regional_rain.isna().all())

    def test_flow_gate_is_convex_and_does_not_read_target(self):
        frame=self.data();log=np.array([1.,10.,100.,1000.]);raw=log*2
        config={'signal':'predicted_flow','low':10,'high':100,'raw_cap':.75}
        expected=combine(log,raw,frame,config)
        self.assertTrue(((expected>=log)&(expected<=raw)).all())
        self.assertEqual(expected[0],log[0]);frame['discharge_cfs']=9e12
        np.testing.assert_array_equal(expected,combine(log,raw,frame,config))

if __name__=='__main__':unittest.main()
