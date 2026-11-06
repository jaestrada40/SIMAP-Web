-- Sesión "pendiente": ya puso la clave pero aún no el código MFA (dura 5 min, sin acceso a nada).
ALTER TABLE sessions ADD COLUMN pending BOOLEAN NOT NULL DEFAULT false;

-- Último paso TOTP aceptado: un código ya usado no se puede reutilizar.
ALTER TABLE users ADD COLUMN mfa_last_step BIGINT;

-- ON DELETE SET NULL haría un UPDATE sobre audit_log y el candado de solo inserción lo bloquearía.
-- La auditoría guarda el id y el nombre como texto; no necesita llave foránea.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_user_id_fkey;
