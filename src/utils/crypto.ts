import crypto from 'node:crypto';
import type { ApiKeyEnvironment } from '../types/auth';

/**
 * Hashes a plaintext password using crypto.scryptSync with a cryptographically secure random salt.
 * Returns format: "salt:hash"
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored "salt:hash" string using timing-safe comparison.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) {
      return false;
    }
    const [salt, originalHash] = parts;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const originalBuffer = Buffer.from(originalHash, 'hex');
    const derivedBuffer = derivedKey;

    if (originalBuffer.length !== derivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(originalBuffer, derivedBuffer);
  } catch {
    return false;
  }
}

/**
 * Computes a SHA-256 hex digest of an API key or token.
 */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * Generates an API key with 256 bits of entropy.
 * Returns the raw key (shown only once), its safe display prefix, and its SHA-256 hash.
 */
export function generateApiKey(environment: ApiKeyEnvironment = 'live'): {
  apiKey: string;
  keyPrefix: string;
  secretHash: string;
} {
  const randomSecret = crypto.randomBytes(32).toString('hex');
  const prefixType = environment === 'test' ? 'pf_test_' : 'pf_live_';
  const apiKey = `${prefixType}${randomSecret}`;
  const keyPrefix = `${prefixType}${randomSecret.slice(0, 8)}...`;
  const secretHash = hashSecret(apiKey);

  return {
    apiKey,
    keyPrefix,
    secretHash,
  };
}

/**
 * Generates a high-entropy session ID.
 */
export function generateSessionId(): string {
  return `ses_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Generates an ID with a specified prefix (e.g. usr_, key_).
 */
export function generateId(prefix: string): string {
  const cleanPrefix = prefix.endsWith('_') ? prefix : `${prefix}_`;
  return `${cleanPrefix}${crypto.randomUUID().replace(/-/g, '')}`;
}
