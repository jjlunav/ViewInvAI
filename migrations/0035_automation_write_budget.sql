PRAGMA foreign_keys = ON;

-- Presupuesto conservador de escrituras automáticas. No interviene en operaciones
-- iniciadas por el usuario; solo permite frenar análisis automáticos no esenciales.
CREATE TABLE IF NOT EXISTS automation_write_budget (
  day TEXT PRIMARY KEY,
  estimated_rows INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_write_budget_updated
  ON automation_write_budget(updated_at DESC);
