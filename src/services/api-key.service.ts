import { ApiKeyRepository } from '../repositories/api-key.repository';
import { UserRepository } from '../repositories/user.repository';
import { generateApiKey, generateId, hashSecret } from '../utils/crypto';
import type {
  ApiKey,
  ApiKeyEnvironment,
  ApiKeySafe,
  User,
} from '../types/auth';

export type ApiKeyValidationResult =
  | { success: true; user: User; apiKey: ApiKey }
  | {
      success: false;
      error:
        | 'INVALID_API_KEY'
        | 'API_KEY_REVOKED'
        | 'USER_SUSPENDED'
        | 'USER_NOT_FOUND';
    };

export class ApiKeyService {
  /**
   * Creates a new API key. The raw API key is returned only once.
   */
  static async createApiKey(
    userId: string,
    name: string = 'Default',
    environment: ApiKeyEnvironment = 'live'
  ): Promise<{
    apiKey: {
      id: string;
      name: string;
      key: string;
      createdAt: string;
    };
  }> {
    const keyId = generateId('key');
    const { apiKey, keyPrefix, secretHash } = generateApiKey(environment);
    const now = new Date().toISOString();

    const record: ApiKey = {
      keyId,
      userId,
      name,
      keyPrefix,
      secretHash,
      environment,
      status: 'active',
      createdAt: now,
    };

    await ApiKeyRepository.createApiKey(record);

    return {
      apiKey: {
        id: keyId,
        name,
        key: apiKey,
        createdAt: now,
      },
    };
  }

  /**
   * Lists safe metadata for all API keys owned by a user.
   */
  static async listApiKeys(userId: string): Promise<ApiKeySafe[]> {
    const keys = await ApiKeyRepository.listApiKeysByUserId(userId);

    return keys.map((k) => ({
      id: k.keyId,
      name: k.name,
      keyPrefix: k.keyPrefix,
      environment: k.environment,
      status: k.status,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));
  }

  /**
   * Revokes an API key. Once revoked, it immediately ceases to function.
   */
  static async revokeApiKey(userId: string, keyId: string): Promise<boolean> {
    const updated = await ApiKeyRepository.revokeApiKey(userId, keyId);
    return !!updated;
  }

  /**
   * Validates a raw Bearer API key token and returns the authenticated user and key record.
   */
  static async validateApiKey(rawKey: string): Promise<ApiKeyValidationResult> {
    if (!rawKey || typeof rawKey !== 'string') {
      return { success: false, error: 'INVALID_API_KEY' };
    }

    const secretHash = hashSecret(rawKey.trim());
    const apiKey = await ApiKeyRepository.getApiKeyByHash(secretHash);

    if (!apiKey) {
      return { success: false, error: 'INVALID_API_KEY' };
    }

    if (apiKey.status === 'revoked') {
      return { success: false, error: 'API_KEY_REVOKED' };
    }

    const user = await UserRepository.getUserById(apiKey.userId);
    if (!user) {
      return { success: false, error: 'USER_NOT_FOUND' };
    }

    if (user.status !== 'active') {
      return { success: false, error: 'USER_SUSPENDED' };
    }

    // Update lastUsedAt asynchronously in the background
    const now = new Date().toISOString();
    ApiKeyRepository.updateApiKeyLastUsed(apiKey.userId, apiKey.keyId, now).catch(() => {});

    return {
      success: true,
      user,
      apiKey,
    };
  }
}
