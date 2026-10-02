-- Decisión del usuario ante un aviso que pide actuar: vender una posición (mantener, vender,
-- más tarde) o comprar un favorito con señal del Radar (compraré, no compro, más tarde).
-- Una decisión vigente por posición o favorito (position_id guarda el id de cualquiera de los dos).
CREATE TABLE IF NOT EXISTS position_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  stock_key TEXT NOT NULL DEFAULT '',
  ticker TEXT NOT NULL DEFAULT '',
  subject_type TEXT NOT NULL DEFAULT 'position',
  decision TEXT NOT NULL CHECK(decision IN ('hold','sell','later','buy','skip')),
  alert_id TEXT,
  avg_price REAL,
  price_at_decision REAL,
  loss_pct_at_decision REAL,
  last_risk_loss_pct REAL,
  review_at TEXT,
  recovered_notified_at TEXT,
  average_notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_position_decisions_position ON position_decisions(user_id,position_id);
