-- RainLine — esquema do banco D1
-- Rode uma vez no console do Cloudflare (D1 > sua base > Console) ou por:
--   npx wrangler d1 execute rainline --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'seller',   -- 'admin' ou 'seller'
  salt       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  client_name TEXT,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  phone       TEXT,
  email       TEXT,
  feet        REAL DEFAULT 0,
  total       REAL DEFAULT 0,
  status      TEXT DEFAULT 'draft',            -- draft | sent | accepted | lost
  data        TEXT NOT NULL,                   -- o orçamento inteiro em JSON
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);

CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL,
  key        TEXT NOT NULL,                    -- caminho no R2
  level      INTEGER DEFAULT 1,
  feet       REAL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_job ON photos(job_id);

-- usuário inicial: admin / 1234  → TROQUE A SENHA NO PRIMEIRO ACESSO
INSERT OR IGNORE INTO users (id, username, name, role, salt, hash, active, created_at)
VALUES (
  'u_admin',
  'admin',
  'Administrador',
  'admin',
  'e408862c3aad2ff3efd3a7e6e8022393',
  'ae8618bb2ebd79c75ff3a895b7e2fb3137fd4406ab515ef4fd121f075a9e0dc1',
  1,
  strftime('%s','now') * 1000
);
