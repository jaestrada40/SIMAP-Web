CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('administrador', 'operador', 'lector')),
  active        BOOLEAN NOT NULL DEFAULT true,
  mfa_secret    TEXT,              -- cifrado AES-256-GCM, nunca en claro
  mfa_enabled   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesión opaca: se guarda solo el hash del token, así una filtración de la base no sirve para entrar.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE auth_rate_limits (
  rate_key          TEXT PRIMARY KEY,
  attempts          INTEGER NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  locked_until      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  action     TEXT NOT NULL,
  detail     JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- Solo inserción: nadie edita ni borra el historial desde la aplicación.
CREATE FUNCTION audit_log_no_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log es de solo inserción'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_no_change();
