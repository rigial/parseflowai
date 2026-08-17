import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../services/dynamo.service';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import type { User } from '../types/auth';

export class UserRepository {
  /**
   * Creates a new user profile and email index record.
   * Throws an error if the email is already registered.
   */
  static async createUser(user: User): Promise<User> {
    const userItem = {
      PK: `USER#${user.userId}`,
      SK: 'PROFILE',
      entityType: 'USER',
      userId: user.userId,
      email: user.email,
      passwordHash: user.passwordHash,
      status: user.status,
      plan: user.plan || 'free',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
    };

    const emailLookupItem = {
      PK: `EMAIL#${user.email}`,
      SK: 'USER',
      entityType: 'EMAIL_LOOKUP',
      email: user.email,
      userId: user.userId,
    };

    try {
      // 1. Reserve email with conditional check to guarantee uniqueness
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: emailLookupItem,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );

      // 2. Put user profile
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: userItem,
        })
      );

      return user;
    } catch (error: any) {
      if (
        error.name === 'ConditionalCheckFailedException' ||
        error.code === 'ConditionalCheckFailedException'
      ) {
        const err = new Error('Email already exists');
        err.name = 'EmailAlreadyExistsError';
        throw err;
      }
      logger.error('UserRepository.createUser failed', {
        userId: user.userId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Retrieves a user by their unique userId.
   */
  static async getUserById(userId: string): Promise<User | null> {
    try {
      const response = await dynamo.send(
        new GetCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            PK: `USER#${userId}`,
            SK: 'PROFILE',
          },
        })
      );

      if (!response.Item) {
        return null;
      }

      return {
        userId: response.Item.userId,
        email: response.Item.email,
        passwordHash: response.Item.passwordHash,
        status: response.Item.status,
        plan: response.Item.plan || 'free',
        createdAt: response.Item.createdAt,
        updatedAt: response.Item.updatedAt,
        lastLoginAt: response.Item.lastLoginAt,
      };
    } catch (error: any) {
      logger.error('UserRepository.getUserById failed', {
        userId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Retrieves a user by their email address via the email index record.
   */
  static async getUserByEmail(email: string): Promise<User | null> {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const emailLookup = await dynamo.send(
        new GetCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            PK: `EMAIL#${normalizedEmail}`,
            SK: 'USER',
          },
        })
      );

      if (!emailLookup.Item || !emailLookup.Item.userId) {
        return null;
      }

      return this.getUserById(emailLookup.Item.userId);
    } catch (error: any) {
      logger.error('UserRepository.getUserByEmail failed', {
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Updates user lastLoginAt and updatedAt timestamp.
   */
  static async updateLastLogin(userId: string, lastLoginAt: string): Promise<void> {
    const updatedAt = new Date().toISOString();
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            PK: `USER#${userId}`,
            SK: 'PROFILE',
          },
          UpdateExpression: 'SET lastLoginAt = :lastLoginAt, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':lastLoginAt': lastLoginAt,
            ':updatedAt': updatedAt,
          },
        })
      );
    } catch (error: any) {
      logger.error('UserRepository.updateLastLogin failed', {
        userId,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }
}
