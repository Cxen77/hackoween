import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
from solution import FEATURES, features, read_input, validate_output, metrics

class SubmissionTests(unittest.TestCase):
    def frame(self):
        return pd.DataFrame({'station_id':['01646500','07010000'],'date':['2024-01-01','2024-01-02'],
                             **{col:[1.,2.] for col in FEATURES}})

    def test_station_ids_keep_leading_zeros(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'input.csv';self.frame().to_csv(path,index=False)
            self.assertEqual(read_input(path).station_id.iloc[0],'01646500')

    def test_target_never_enters_features(self):
        frame=self.frame();frame['discharge_cfs']=[1.,2.]
        before=features(frame);frame['discharge_cfs']=[1e10,9e10]
        pd.testing.assert_frame_equal(before,features(frame))
        self.assertNotIn('station_id',before.columns)

    def test_output_contract_rejects_nonfinite_negative_and_wrong_keys(self):
        test=self.frame()
        for values in ([np.nan,2.],[-1.,2.],[np.inf,2.]):
            output=test[['station_id','date']].copy();output['discharge_cfs']=values
            with self.assertRaises(ValueError):validate_output(test,output)
        output=test[['station_id','date']].iloc[::-1].copy();output['discharge_cfs']=[1.,2.]
        with self.assertRaises(ValueError):validate_output(test,output)

    def test_output_contract_accepts_exact_rows(self):
        test=self.frame();output=test[['station_id','date']].copy();output['discharge_cfs']=[0.,1.5]
        validate_output(test,output)

    def test_extreme_metrics_are_per_station(self):
        result=metrics([1.,10.,100.,1000.],np.array([1.,10.,100.,900.]),['a','a','b','b'])
        self.assertEqual(result['extreme_rows'],2)
        self.assertAlmostEqual(result['extreme_rmse'],np.sqrt(10000/2))

    def test_antecedent_rain_uses_past_only(self):
        frame=pd.concat([self.frame().iloc[[0]]]*3,ignore_index=True)
        frame['date']=['2024-01-01','2024-01-02','2024-01-03']
        frame['precipitation_mm']=[1.,2.,999.]
        values=features(frame)['rain_previous_7d'].to_numpy()
        self.assertTrue(np.isnan(values[0]));self.assertEqual(values[1],1.);self.assertEqual(values[2],3.)

if __name__=='__main__':unittest.main()
