-- The Fold V2.1.0 Configuration
-- Adds config table for system-wide configuration parameters

-- ============================================================================
-- TABLE: config
-- ============================================================================

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL DEFAULT 'string'
    CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Update timestamp trigger for config
CREATE TRIGGER config_updated_at
  BEFORE UPDATE ON config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- DEFAULT CONFIGURATION VALUES
-- ============================================================================

-- Drift Aperture: Controls the semantic distance range for Overtone selection
-- Range: 0.1 (tight/anchor mode) to 0.3 (wide/chaos mode)
-- Default: 0.2 (Lyapunov Sweet Spot - balanced synthesis)
INSERT INTO config (key, value, description, value_type)
VALUES (
  'drift_aperture',
  '0.2',
  'Controls semantic distance range for Overtone selection in The Fold. Range: 0.1-0.3',
  'number'
) ON CONFLICT (key) DO NOTHING;

-- Fold minimum consonance threshold (Ψ)
-- Harmonicmean threshold below which synthesis is rejected as "dross"
INSERT INTO config (key, value, description, value_type)
VALUES (
  'fold_min_consonance',
  '0.40',
  'Minimum harmonic mean (Psi) for synthesis to be accepted. Below this is dross.',
  'number'
) ON CONFLICT (key) DO NOTHING;

-- Fold convergent evolution similarity threshold
-- Above this threshold, evolve existing memory instead of creating new
INSERT INTO config (key, value, description, value_type)
VALUES (
  'fold_evolution_threshold',
  '0.92',
  'Similarity threshold above which existing memory is evolved instead of creating new',
  'number'
) ON CONFLICT (key) DO NOTHING;

-- REM pulse frequency (autonomous synthesis)
-- How often (in seconds) the autonomous fold runs
INSERT INTO config (key, value, description, value_type)
VALUES (
  'rem_pulse_interval',
  '14400',
  'Interval in seconds between autonomous REM synthesis cycles (default: 4 hours)',
  'number'
) ON CONFLICT (key) DO NOTHING;

-- Active pulse mode (user-triggered synthesis)
INSERT INTO config (key, value, description, value_type)
VALUES (
  'active_pulse_enabled',
  'true',
  'Enable real-time synthesis on user queries',
  'boolean'
) ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get configuration value with type casting
CREATE OR REPLACE FUNCTION get_config(config_key TEXT, default_value TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT value INTO result FROM config WHERE key = config_key;

  IF result IS NULL THEN
    RETURN default_value;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Get configuration value as number
CREATE OR REPLACE FUNCTION get_config_number(config_key TEXT, default_value NUMERIC DEFAULT NULL)
RETURNS NUMERIC AS $$
DECLARE
  result TEXT;
BEGIN
  result := get_config(config_key, default_value::TEXT);

  IF result IS NULL THEN
    RETURN default_value;
  END IF;

  RETURN result::NUMERIC;
END;
$$ LANGUAGE plpgsql;

-- Set configuration value
CREATE OR REPLACE FUNCTION set_config(config_key TEXT, config_value TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE config SET value = config_value, updated_at = NOW() WHERE key = config_key;

  IF NOT FOUND THEN
    INSERT INTO config (key, value) VALUES (config_key, config_value);
  END IF;
END;
$$ LANGUAGE plpgsql;
