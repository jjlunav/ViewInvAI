import unittest
import numpy as np
from corporate_actions import apply_actions


def history(prices):
    p=np.asarray(prices,dtype=float)
    return {'d':np.array(['2026-01-01','2026-01-02','2026-01-03','2026-01-04']),**{k:p.copy() for k in ('o','h','l','c')},'v':np.ones(4)*100}


class CorporateTests(unittest.TestCase):
    def test_news_crash_is_not_rewritten_as_split(self):
        a=history([100,100,50,49]);out=apply_actions(a,[])
        np.testing.assert_equal(a['c'],[100,100,50,49])
        self.assertEqual(out['verifiedSplits'],0);self.assertEqual(out['ambiguousJumps'],1)
        self.assertFalse(a['forwardValid5'][0]);self.assertFalse(a['featureValid'][2])

    def test_confirmed_split_adjusts_prior_prices_and_volume(self):
        a=history([100,100,50,49]);out=apply_actions(a,[{'date':'2026-01-03','numerator':2,'denominator':1}])
        np.testing.assert_equal(a['c'],[50,50,50,49]);self.assertEqual(a['v'][0],200)
        self.assertEqual(out['verifiedSplits'],1);self.assertEqual(out['ambiguousJumps'],0)

    def test_already_adjusted_is_not_adjusted_twice(self):
        a=history([50,50,50,49]);out=apply_actions(a,[{'date':'2026-01-03','numerator':2,'denominator':1}])
        np.testing.assert_equal(a['c'],[50,50,50,49]);self.assertEqual(out['verifiedSplits'],0)

    def test_reverse_split_and_invalid_evidence(self):
        a=history([10,10,100,99]);out=apply_actions(a,[{'date':'2026-01-03','numerator':1,'denominator':10}])
        np.testing.assert_equal(a['c'],[100,100,100,99]);self.assertEqual(out['verifiedSplits'],1)


if __name__=='__main__':unittest.main()
