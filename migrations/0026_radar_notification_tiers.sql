PRAGMA foreign_keys = ON;

-- Radar AI notifications per tier (Alta convicción, Oportunidades, En vigilancia).
ALTER TABLE user_notification_settings
  ADD COLUMN radar_high_enabled INTEGER NOT NULL DEFAULT 0 CHECK(radar_high_enabled IN (0,1));

ALTER TABLE user_notification_settings
  ADD COLUMN radar_opportunity_enabled INTEGER NOT NULL DEFAULT 0 CHECK(radar_opportunity_enabled IN (0,1));

ALTER TABLE user_notification_settings
  ADD COLUMN radar_watch_enabled INTEGER NOT NULL DEFAULT 0 CHECK(radar_watch_enabled IN (0,1));

-- High conviction and opportunities inherit the old «Cambios en Radar IA» / «Pulso IA» choice.
UPDATE user_notification_settings
  SET radar_high_enabled = CASE WHEN radar_enabled = 1 OR pulse_ai_enabled = 1 THEN 1 ELSE 0 END,
      radar_opportunity_enabled = CASE WHEN radar_enabled = 1 OR pulse_ai_enabled = 1 THEN 1 ELSE 0 END;
