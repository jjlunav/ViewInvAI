PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS venue_sessions (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  session_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  sequence_no INTEGER NOT NULL DEFAULT 0,
  open_time_local TEXT NOT NULL,
  close_time_local TEXT NOT NULL,
  reference_session_code TEXT NOT NULL DEFAULT '',
  is_extended INTEGER NOT NULL DEFAULT 0 CHECK(is_extended IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  UNIQUE(venue_id, session_code)
);

CREATE INDEX IF NOT EXISTS idx_venue_sessions_order
  ON venue_sessions(venue_id, active, sequence_no);

CREATE TABLE IF NOT EXISTS market_calendar_exceptions (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  calendar_date TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN (0,1)),
  open_time_override TEXT,
  close_time_override TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  UNIQUE(venue_id, calendar_date)
);

CREATE INDEX IF NOT EXISTS idx_market_calendar_date
  ON market_calendar_exceptions(calendar_date, venue_id);

INSERT OR IGNORE INTO venue_sessions
  (id,venue_id,session_code,display_name,sequence_no,open_time_local,close_time_local,reference_session_code,is_extended)
VALUES
  ('session:nasdaq:pre','venue:nasdaq','premarket','Premarket',10,'04:00','09:30','regular',1),
  ('session:nasdaq:regular','venue:nasdaq','regular','Regular',20,'09:30','16:00','previous_close',0),
  ('session:nasdaq:post','venue:nasdaq','postmarket','Postmarket',30,'16:00','20:00','regular',1),
  ('session:nyse:pre','venue:nyse','premarket','Premarket',10,'04:00','09:30','regular',1),
  ('session:nyse:regular','venue:nyse','regular','Regular',20,'09:30','16:00','previous_close',0),
  ('session:nyse:post','venue:nyse','postmarket','Postmarket',30,'16:00','20:00','regular',1),
  ('session:amex:pre','venue:amex','premarket','Premarket',10,'04:00','09:30','regular',1),
  ('session:amex:regular','venue:amex','regular','Regular',20,'09:30','16:00','previous_close',0),
  ('session:amex:post','venue:amex','postmarket','Postmarket',30,'16:00','20:00','regular',1),
  ('session:nyse-arca:pre','venue:nyse-arca','premarket','Premarket',10,'04:00','09:30','regular',1),
  ('session:nyse-arca:regular','venue:nyse-arca','regular','Regular',20,'09:30','16:00','previous_close',0),
  ('session:nyse-arca:post','venue:nyse-arca','postmarket','Postmarket',30,'16:00','20:00','regular',1),
  ('session:lsx:regular','venue:lsx','regular','LSX',10,'07:30','23:00','previous_close',0);

INSERT OR IGNORE INTO market_calendar_exceptions
  (id,venue_id,calendar_date,is_closed,open_time_override,close_time_override,reason)
VALUES
  ('cal:lsx:2026-01-01','venue:lsx','2026-01-01',1,NULL,NULL,'Festivo LSX'),
  ('cal:lsx:2026-04-03','venue:lsx','2026-04-03',1,NULL,NULL,'Festivo LSX'),
  ('cal:lsx:2026-04-06','venue:lsx','2026-04-06',1,NULL,NULL,'Festivo LSX'),
  ('cal:lsx:2026-05-01','venue:lsx','2026-05-01',1,NULL,NULL,'Festivo LSX'),
  ('cal:lsx:2026-12-24','venue:lsx','2026-12-24',1,NULL,NULL,'Festivo LSX'),
  ('cal:lsx:2026-12-25','venue:lsx','2026-12-25',1,NULL,NULL,'Festivo LSX'),
  ('cal:lsx:2026-12-26','venue:lsx','2026-12-26',1,NULL,NULL,'Festivo LSX'),
  ('cal:lsx:2026-12-30','venue:lsx','2026-12-30',0,'07:30','14:00','Cierre anticipado LSX'),
  ('cal:lsx:2026-12-31','venue:lsx','2026-12-31',1,NULL,NULL,'Festivo LSX');
