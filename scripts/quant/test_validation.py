import unittest
import numpy as np
from validation import auc, chronological_masks, calibration_summary


class ValidationTests(unittest.TestCase):
    def test_training_labels_do_not_cross_split(self):
        train, test = chronological_masks(['2022-12-20','2022-12-30','2023-01-03'],
                                          ['2022-12-28','2023-01-10','2023-01-10'], '2023-01-01')
        np.testing.assert_array_equal(train,[True,False,False])
        np.testing.assert_array_equal(test,[False,False,True])

    def test_tied_predictions_have_auc_half(self):
        self.assertEqual(auc([.5,.5,.5,.5],[0,0,1,1]),.5)
        self.assertEqual(auc([.1,.2,.8,.9],[0,0,1,1]),1)
        self.assertEqual(auc([.9,.8,.2,.1],[0,0,1,1]),0)

    def test_calibration_reports_overconfidence(self):
        out=calibration_summary([.9,.9,.9,.9],[0,1,0,1])
        self.assertAlmostEqual(out['brier'],.41)
        self.assertEqual(out['reliability'][0]['observed'],.5)


if __name__=='__main__':
    unittest.main()
