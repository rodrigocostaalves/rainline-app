-- RainLine — assinatura digital (rode uma vez no Console do D1)

CREATE TABLE IF NOT EXISTS signatures (
  job_id      TEXT PRIMARY KEY,
  signer_name TEXT,
  signature   TEXT NOT NULL,      -- imagem PNG da assinatura, em base64
  signed_at   INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  total       REAL,
  snapshot    TEXT                -- cópia do orçamento no momento da assinatura
);

-- token público de cada orçamento, para o link do cliente
ALTER TABLE jobs ADD COLUMN share_token TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_token ON jobs(share_token);
