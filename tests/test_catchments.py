import unittest
from scripts.download_catchments import normalize

def characteristic(code,value,unit):
    return {'variableType':{'code':code},'value':value,'unitType':{'abbreviation':unit}}

class CatchmentTests(unittest.TestCase):
    def test_converts_basin_units(self):
        self.assertAlmostEqual(normalize(characteristic('ELEV',100,'m'))[1],328.0839895)
        self.assertEqual(normalize(characteristic('FOREST',65,'%')),('forest_cover_pct',65.))
    def test_rejects_discharge_statistics_and_channel_slope(self):
        self.assertIsNone(normalize(characteristic('D1',123000,'ft^3/s')))
        self.assertIsNone(normalize(characteristic('CSLArc10',15,'ft/mi')))
    def test_slope_percent_and_degrees_are_distinct(self):
        self.assertEqual(normalize(characteristic('BSLDEM10M',8,'%')),('slope_pct',8.))
        self.assertAlmostEqual(normalize(characteristic('BSLOPD',45,'°'))[1],100.)
        self.assertIsNone(normalize(characteristic('BSLOPGM',4.15,'ft/ft')))

if __name__=='__main__':unittest.main()
