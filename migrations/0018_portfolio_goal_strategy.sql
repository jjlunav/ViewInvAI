PRAGMA foreign_keys = ON;

ALTER TABLE portfolio_goals ADD COLUMN target_date TEXT;
ALTER TABLE portfolio_goals ADD COLUMN monthly_contribution_eur REAL NOT NULL DEFAULT 0;
ALTER TABLE portfolio_goals ADD COLUMN risk_profile TEXT NOT NULL DEFAULT 'balanced';

UPDATE portfolio_goals
SET monthly_contribution_eur=COALESCE(monthly_contribution_eur,0),
    risk_profile=CASE
      WHEN risk_profile IN ('conservative','balanced','aggressive') THEN risk_profile
      ELSE 'balanced'
    END;
