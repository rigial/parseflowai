import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../services/dynamo.service';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import type { ApiKey } from '../types/auth';

export class ApiKeyRepository {
  /**
   * Creates an API key record for a user and creates a secret hash lookup record for O(1) auth.
   */
  static async createApiKey(apiKey: ApiKey): Promise<ApiKey> {
    const userApiKeyItem = {
      resumeId: `APIKEY#${apiKey.keyId}`,
      customerId: apiKey.userId,
      entityType: 'API_KEY',
      keyId: apiKey.keyId,
      userId: apiKey.userId,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      secretHash: apiKey.secretHash,
      environment: apiKey.environment,
      status: apiKey.status,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
    };

    const lookupItem = {
      resumeId: `APIKEY_HASH#${apiKey.secretHash}`,
      entityType: 'API_KEY_LOOKUP',
      userId: apiKey.userId,
      keyId: apiKey.keyId,
      secretHash: apiKey.secretHash,
    };

    try {
      // Write user's API key record
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: userApiKeyItem,
        })
      );

      // Write lookup record for fast auth
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: lookupItem,
        })
      );

      return apiKey;
    } catch (error: any) {
      logger.error('ApiKeyRepository.createApiKey failed', {
        userId: apiKey.userId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Retrieves an API key by its SHA-256 secret hash.
   */
  static async getApiKeyByHash(secretHash: string): Promise<ApiKey | null> {
    try {
      // 1. Get lookup item
      const lookupResponse = await dynamo.send(
        new GetCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `APIKEY_HASH#${secretHash}`,
          },
        })
      );

      if (!lookupResponse.Item || !lookupResponse.Item.userId || !lookupResponse.Item.keyId) {
        return null;
      }

      const { userId, keyId } = lookupResponse.Item;

      // 2. Fetch full API key record
      return this.getApiKeyById(userId, keyId);
    } catch (error: any) {
      logger.error('ApiKeyRepository.getApiKeyByHash failed', {
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Retrieves an API key by userId and keyId.
   */
  static async getApiKeyById(userId: string, keyId: string): Promise<ApiKey | null> {
    try {
      const response = await dynamo.send(
        new GetCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `APIKEY#${keyId}`,
          },
        })
      );

      if (!response.Item || (userId && response.Item.userId !== userId)) {
        return null;
      }

      return {
        keyId: response.Item.keyId,
        userId: response.Item.userId,
        name: response.Item.name,
        keyPrefix: response.Item.keyPrefix,
        secretHash: response.Item.secretHash,
        environment: response.Item.environment,
        status: response.Item.status,
        createdAt: response.Item.createdAt,
        lastUsedAt: response.Item.lastUsedAt,
        revokedAt: response.Item.revokedAt,
      };
    } catch (error: any) {
      logger.error('ApiKeyRepository.getApiKeyById failed', {
        userId,
        keyId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Lists all API keys belonging to a specific user using GSI customerId-createdAt-index.
   */
  static async listApiKeysByUserId(userId: string): Promise<ApiKey[]> {
    try {
      const response = await dynamo.send(
        new QueryCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          IndexName: 'customerId-createdAt-index',
          KeyConditionExpression: 'customerId = :cid',
          ExpressionAttributeValues: {
            ':cid': userId,
          },
        })
      );

      if (!response.Items || response.Items.length === 0) {
        return [];
      }

      const keyItems = response.Items.filter(
        (item) =>
          item.resumeId &&
          (item.resumeId.startsWith('APIKEY#') || item.entityType === 'API_KEY')
      );

      if (keyItems.length === 0) {
        return [];
      }

      const fullRecords = await Promise.all(
        keyItems.map(async (item) => {
          const keyId = item.keyId || item.resumeId.replace('APIKEY#', '');
          const res = await dynamo.send(
            new GetCommand({
              TableName: env.DYNAMODB_TABLE_NAME,
              Key: {
                resumeId: `APIKEY#${keyId}`,
              },
            })
          );
          return res.Item;
        })
      );

      return fullRecords
        .filter(
          (rec): rec is Record<string, any> =>
            !!rec && (!rec.entityType || rec.entityType === 'API_KEY')
        )
        .map((item) => ({
          keyId: item.keyId || item.resumeId.replace('APIKEY#', ''),
          userId: item.userId || userId,
          name: item.name || 'API Key',
          keyPrefix:
            item.keyPrefix ||
            (item.keyId ? `pf_live_${item.keyId.slice(0, 8)}...` : 'pf_live_...'),
          secretHash: item.secretHash || '',
          environment: item.environment || 'live',
          status: item.status || 'active',
          createdAt: item.createdAt || new Date().toISOString(),
          lastUsedAt: item.lastUsedAt,
          revokedAt: item.revokedAt,
        }));
    } catch (error: any) {
      logger.error('ApiKeyRepository.listApiKeysByUserId failed', {
        userId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Revokes an API key for a user.
   */
  static async revokeApiKey(userId: string, keyId: string): Promise<ApiKey | null> {
    const revokedAt = new Date().toISOString();

    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `APIKEY#${keyId}`,
          },
          UpdateExpression: 'SET #status = :status, revokedAt = :revokedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'revoked',
            ':revokedAt': revokedAt,
          },
        })
      );

      return this.getApiKeyById(userId, keyId);
    } catch (error: any) {
      logger.error('ApiKeyRepository.revokeApiKey failed', {
        userId,
        keyId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Updates lastUsedAt timestamp on an API key record.
   */
  static async updateApiKeyLastUsed(
    userId: string,
    keyId: string,
    lastUsedAt: string
  ): Promise<void> {
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `APIKEY#${keyId}`,
          },
          UpdateExpression: 'SET lastUsedAt = :lastUsedAt',
          ExpressionAttributeValues: {
            ':lastUsedAt': lastUsedAt,
          },
        })
      );
    } catch (error: any) {
      logger.error('ApiKeyRepository.updateApiKeyLastUsed failed', {
        userId,
        keyId,
        errorCode: error.name || error.code,
      });
      // Do not throw on non-critical lastUsedAt update
    }
  }
}
