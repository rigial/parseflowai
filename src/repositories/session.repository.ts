import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../services/dynamo.service';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import type { Session } from '../types/auth';

export class SessionRepository {
  /**
   * Creates a session record in DynamoDB with a TTL.
   */
  static async createSession(session: Session): Promise<Session> {
    const expiresAtSeconds = Math.floor(new Date(session.expiresAt).getTime() / 1000);

    const item = {
      resumeId: `SESSION#${session.sessionId}`,
      customerId: session.userId,
      entityType: 'SESSION',
      sessionId: session.sessionId,
      userId: session.userId,
      status: 'active',
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ttl: expiresAtSeconds,
    };

    try {
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: item,
        })
      );
      return session;
    } catch (error: any) {
      logger.error('SessionRepository.createSession failed', {
        userId: session.userId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Retrieves a session by its sessionId.
   * Returns null if not found, invalidated, or expired.
   */
  static async getSession(sessionId: string): Promise<Session | null> {
    try {
      const response = await dynamo.send(
        new GetCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `SESSION#${sessionId}`,
          },
        })
      );

      if (!response.Item || response.Item.status === 'invalidated') {
        return null;
      }

      // Check if session has expired in memory as well
      const expiresAtDate = new Date(response.Item.expiresAt);
      if (expiresAtDate.getTime() < Date.now()) {
        return null;
      }

      return {
        sessionId: response.Item.sessionId,
        userId: response.Item.userId,
        createdAt: response.Item.createdAt,
        expiresAt: response.Item.expiresAt,
      };
    } catch (error: any) {
      logger.error('SessionRepository.getSession failed', {
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Invalidates a session in DynamoDB by setting status to invalidated and expiresAt to past.
   * Uses UpdateCommand so it doesn't require dynamodb:DeleteItem IAM permissions.
   */
  static async deleteSession(sessionId: string): Promise<void> {
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `SESSION#${sessionId}`,
          },
          UpdateExpression: 'SET expiresAt = :expired, #status = :status, #ttl = :ttl',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':expired': '1970-01-01T00:00:00.000Z',
            ':status': 'invalidated',
            ':ttl': 0,
          },
        })
      );
    } catch (error: any) {
      logger.error('SessionRepository.deleteSession failed', {
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }
}
