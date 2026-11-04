import unittest
import numpy as np
from scripts.robust_ensemble import minimax_weights


class RobustEnsembleTests(unittest.TestCase):
    def test_complementary_errors_balance_the_worst_regime(self):
        # Each individual model fails one regime; their blend solves both.
        matrices=np.array([[[1.,0.],[0.,4.]],[[4.,0.],[0.,1.]]])
        weights,result=minimax_weights(matrices,[1.,0.])
        self.assertTrue(result['success'])
        np.testing.assert_allclose(weights,[.5,.5],atol=1e-5)
        self.assertAlmostEqual(result['worst_relative_mse'],1.25,places=6)

    def test_duplicate_predictions_cannot_manufacture_gain(self):
        weights,result=minimax_weights([np.ones((2,2))],[.25,.75])
        self.assertTrue(result['success'])
        self.assertAlmostEqual(result['worst_relative_mse'],1.,places=8)
        self.assertTrue((weights>=0).all())
        self.assertAlmostEqual(weights.sum(),1.)

    def test_nonfinite_covariance_is_rejected(self):
        with self.assertRaises(ValueError):minimax_weights([[[np.nan]]],[1.])


if __name__=='__main__':unittest.main()
