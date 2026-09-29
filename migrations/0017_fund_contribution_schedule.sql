PRAGMA foreign_keys = ON;

ALTER TABLE fund_contribution_plans ADD COLUMN start_date TEXT;
ALTER TABLE fund_contribution_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE fund_contribution_plans ADD COLUMN next_contribution_at TEXT;

UPDATE fund_contribution_plans
SET status = CASE WHEN enabled=1 THEN 'active' ELSE 'paused' END
WHERE status IS NULL OR status='';

CREATE INDEX IF NOT EXISTS idx_fund_plans_next
  ON fund_contribution_plans(user_id,status,next_contribution_at);
