"""Corporate-action evidence and masks for ambiguous historical discontinuities."""
import numpy as np


def candidates(a):
    c, o = a['c'], a['o']
    found = []
    factors = [2,3,4,5,6,8,10,12,15,20,25,30,40,50,100,200,250,1000]
    for i in range(1,len(c)):
        if not(c[i-1]>0 and c[i]>0 and o[i]>0):
            continue
        r, opening = c[i]/c[i-1], o[i]/c[i-1]
        if any(abs(r/f-1)<.06 and abs(opening/f-1)<.06 for k in factors for f in (1/k,k)):
            found.append(i)
    return found


def apply_actions(a, events):
    """Adjust only event-backed raw price steps; already-adjusted series stay intact.

    Ambiguous jumps are not called splits. Their target windows and subsequent
    252-session feature windows are excluded and counted explicitly.
    """
    n=len(a['c']); adjustment=np.ones(n); verified=set(); evidence=set(); adjusted=0
    dates=np.asarray(a['d']); c, o = a['c'], a['o']
    for event in events or []:
        try:
            day=str(event['date'])[:10]; factor=float(event['denominator'])/float(event['numerator'])
            if not np.isfinite(factor) or not(0<factor<1e6) or abs(factor-1)<1e-9:
                continue
            i=int(np.searchsorted(dates,day))
            if i<1 or i>=n or dates[i]!=day or not(c[i-1]>0 and o[i]>0):
                continue
            ratio=o[i]/c[i-1]
            if abs(ratio/factor-1)<.2:
                adjustment[:i]*=factor;verified.add(i);evidence.add(i);adjusted+=1
            elif abs(ratio-1)<.2:
                evidence.add(i)  # this source has already adjusted that split
        except (KeyError,ValueError,TypeError,ZeroDivisionError):
            continue
    ambiguous=[i for i in candidates(a) if i not in evidence]
    feature_valid=np.ones(n,dtype=bool)
    for i in ambiguous:
        feature_valid[i:min(n,i+252)]=False
    for key in ('o','h','l','c'):
        a[key]=a[key]*adjustment
    a['v']=a['v']/adjustment
    a['featureValid']=feature_valid
    for horizon in (1,5,20):
        valid=np.ones(n,dtype=bool)
        for i in ambiguous:
            valid[max(0,i-horizon):i]=False
        a['forwardValid'+str(horizon)]=valid
    a['corporateQuality']={'verifiedSplits':adjusted,'ambiguousJumps':len(ambiguous),'excludedFeatureRows':int((~feature_valid).sum())}
    return a['corporateQuality']
