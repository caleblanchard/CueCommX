CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'operator', 'user')),
  settings_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  sort_order INTEGER DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  can_talk BOOLEAN NOT NULL DEFAULT 0,
  can_listen BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS server_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO channels (id, name, color, sort_order, priority) VALUES
  ('ch-production', 'Production', '#EF4444', 1, 8),
  ('ch-audio', 'Audio', '#3B82F6', 2, 5),
  ('ch-video', 'Video/Camera', '#10B981', 3, 5),
  ('ch-lighting', 'Lighting', '#F59E0B', 4, 5),
  ('ch-stage', 'Stage', '#8B5CF6', 5, 5);

-- Groups feature
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_channels (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, channel_id)
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

-- Event log
CREATE TABLE IF NOT EXISTS event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  event_type TEXT NOT NULL,
  user_id TEXT,
  username TEXT,
  channel_id TEXT,
  channel_name TEXT,
  details TEXT,
  severity TEXT NOT NULL DEFAULT 'info'
);

CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_event_log_event_type ON event_log(event_type);
CREATE INDEX IF NOT EXISTS idx_event_log_user_id ON event_log(user_id);
