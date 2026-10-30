import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

const PHONE_ENCRYPTION_KEY_ENV = 'FAA_PHONE_ENCRYPTION_KEY';
const PHONE_HMAC_KEY_ENV = 'FAA_PHONE_HMAC_KEY';

function readKey(name: string): Buffer {
  const value = process.env[name];
  if (!value) throw new Error('Phone protection is not configured.');
  const key = Buffer.from(value, 'base64');
  if (key.byteLength !== 32) throw new Error('Phone protection is not configured.');
  return key;
}

function readPhoneKeys() {
  const encryption = readKey(PHONE_ENCRYPTION_KEY_ENV);
  const hmac = readKey(PHONE_HMAC_KEY_ENV);
  if (encryption.equals(hmac)) throw new Error('Phone protection keys must be independent.');
  return { encryption, hmac };
}

export function normalizeIndianPhone(value: string): string | null {
  const digits = value.replace(/[^0-9]/g, '').replace(/^0091/, '91');
  const national = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^[6-9][0-9]{9}$/.test(national)) return null;
  return `+91${national}`;
}

export function hashPhone(phoneE164: string): string {
  return createHmac('sha256', readPhoneKeys().hmac).update(phoneE164).digest('hex');
}

export function encryptPhone(phoneE164: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readPhoneKeys().encryption, iv);
  const ciphertext = Buffer.concat([cipher.update(phoneE164, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}
