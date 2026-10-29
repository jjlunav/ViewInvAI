"""Validation helpers; all fitted transformations remain training-only."""
import numpy as np


def chronological_masks(days, label_ends, split):
    days, label_ends = np.asarray(days), np.asarray(label_ends)
    # A training label must be completely known before the first test day.
    return (days < split) & (label_ends < split), days >= split


def auc(score, y):
    score, y = np.asarray(score), np.asarray(y)
    order = np.argsort(score, kind="stable")
    sorted_score = score[order]
    starts = np.r_[0, np.flatnonzero(np.diff(sorted_score)) + 1]
    ends = np.r_[starts[1:], len(score)]
    ranks = np.empty(len(score))
    ranks[order] = np.repeat((starts + 1 + ends) / 2, ends - starts)
    pos = y == 1
    npos, nneg = pos.sum(), (~pos).sum()
    if not npos or not nneg:
        return None
    return float((ranks[pos].sum() - npos * (npos + 1) / 2) / (npos * nneg))


def calibration_summary(score, y):
    score, y = np.asarray(score), np.asarray(y)
    bins = []
    for low in np.arange(0, 1, 0.1):
        mask = (score >= low) & (score < low + 0.1 if low < 0.9 else score <= 1)
        if mask.any():
            bins.append({"n": int(mask.sum()), "predicted": round(float(score[mask].mean()), 4),
                         "observed": round(float(y[mask].mean()), 4)})
    return {"brier": round(float(np.mean((score-y)**2)), 6),
            "constantBrier": round(float(np.mean((y-y.mean())**2)), 6), "reliability": bins}


def period_summary(days, score, y, excess):
    days,score,y,excess=map(np.asarray,(days,score,y,excess))
    out=[]
    for year in sorted(set(str(d)[:4] for d in days)):
        mask=np.char.startswith(days.astype(str),year)
        p,t,e=score[mask],y[mask],excess[mask]
        top=np.argsort(p)[-max(1,int(np.ceil(len(p)*.1))):]
        out.append({'year':year,'n':int(mask.sum()),'auc':auc(p,t),
                    'calibration':calibration_summary(p,t),
                    'topDecileMeanExcess':round(float(e[top].mean()),4)})
    return out


def cost_scenarios(score, excess):
    score,excess=map(np.asarray,(score,excess))
    top=np.argsort(score)[-max(1,int(np.ceil(len(score)*.1))):]
    return [{'roundTripBps':cost,'topDecileMeanExcessNetPct':round(float(excess[top].mean())-cost/100,4)}
            for cost in (0,25,100,200)]
