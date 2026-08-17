import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
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
      PK: `SESSION#${session.sessionId}`,
      SK: 'SESSION',
      entityType: 'SESSION',
      sessionId: session.sessionId,
      userId: session.userId,
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
   * Returns null if not found or expired.
   */
  static async getSession(sessionId: string): Promise<Session | null> {
    try {
      const response = await dynamo.send(
        new GetCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            PK: `SESSION#${sessionId}`,
            SK: 'SESSION',
          },
        })
      );

      if (!response.Item) {
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
   * Deletes a session from DynamoDB.
   */
  static async deleteSession(sessionId: string): Promise<void> {
    try {
      await dynamo.send(
        new DeleteCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            PK: `SESSION#${sessionId}`,
            SK: 'SESSION',
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
