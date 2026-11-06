import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Sin clave de respaldo: si falta MFA_ENCRYPTION_KEY, el servicio no cifra ni descifra nada.
function key(): Buffer {
  const k = Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('MFA_ENCRYPTION_KEY debe ser de 32 bytes en base64.');
  return k;
}

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(value: string): string {
  const [v, iv, tag, data] = value.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Secreto cifrado inválido.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
