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
