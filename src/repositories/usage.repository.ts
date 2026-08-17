import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../services/dynamo.service';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import { generateId } from '../utils/crypto';
import type {
  ApiUsage,
  DailyUsage,
  ResumeUsage,
  TokenUsage,
} from '../types/usage';

export interface DailyIncrementParams {
  requests?: number;
  resumesUploaded?: number;
  resumesParsed?: number;
  parseFailures?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export class UsageRepository {
  /**
   * Atomically increments daily usage counters for a user using DynamoDB ADD.
   */
  static async incrementDailyUsage(
    userId: string,
    date: string, // YYYY-MM-DD
    increments: DailyIncrementParams
  ): Promise<void> {
    const addExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {
      '#date': 'date',
      '#userId': 'userId',
      '#customerId': 'customerId',
      '#entityType': 'entityType',
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, any> = {
      ':date': date,
      ':userId': userId,
      ':customerId': userId,
      ':entityType': 'DAILY_USAGE',
      ':updatedAt': new Date().toISOString(),
    };

    if (increments.requests && increments.requests > 0) {
      addExpressions.push('#requests :inc_requests');
      expressionAttributeNames['#requests'] = 'requests';
      expressionAttributeValues[':inc_requests'] = increments.requests;
    }

    if (increments.resumesUploaded && increments.resumesUploaded > 0) {
      addExpressions.push('#resumesUploaded :inc_resumesUploaded');
      expressionAttributeNames['#resumesUploaded'] = 'resumesUploaded';
      expressionAttributeValues[':inc_resumesUploaded'] = increments.resumesUploaded;
    }

    if (increments.resumesParsed && increments.resumesParsed > 0) {
      addExpressions.push('#resumesParsed :inc_resumesParsed');
      expressionAttributeNames['#resumesParsed'] = 'resumesParsed';
      expressionAttributeValues[':inc_resumesParsed'] = increments.resumesParsed;
    }

    if (increments.parseFailures && increments.parseFailures > 0) {
      addExpressions.push('#parseFailures :inc_parseFailures');
      expressionAttributeNames['#parseFailures'] = 'parseFailures';
      expressionAttributeValues[':inc_parseFailures'] = increments.parseFailures;
    }

    if (increments.inputTokens && increments.inputTokens > 0) {
      addExpressions.push('#inputTokens :inc_inputTokens');
      expressionAttributeNames['#inputTokens'] = 'inputTokens';
      expressionAttributeValues[':inc_inputTokens'] = increments.inputTokens;
    }

    if (increments.outputTokens && increments.outputTokens > 0) {
      addExpressions.push('#outputTokens :inc_outputTokens');
      expressionAttributeNames['#outputTokens'] = 'outputTokens';
      expressionAttributeValues[':inc_outputTokens'] = increments.outputTokens;
    }

    if (increments.totalTokens && increments.totalTokens > 0) {
      addExpressions.push('#totalTokens :inc_totalTokens');
      expressionAttributeNames['#totalTokens'] = 'totalTokens';
      expressionAttributeValues[':inc_totalTokens'] = increments.totalTokens;
    }

    let updateExpression =
      'SET #date = :date, #userId = :userId, #customerId = :customerId, #entityType = :entityType, #updatedAt = :updatedAt';
    if (addExpressions.length > 0) {
      updateExpression += ` ADD ${addExpressions.join(', ')}`;
    }

    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `USAGE#${userId}#${date}`,
          },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );
    } catch (error: any) {
      logger.error('UsageRepository.incrementDailyUsage failed', {
        userId,
        date,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Retrieves single-day usage counters for a user.
   */
  static async getDailyUsage(userId: string, date: string): Promise<DailyUsage | null> {
    try {
      const response = await dynamo.send(
        new GetCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Key: {
            resumeId: `USAGE#${userId}#${date}`,
          },
        })
      );

      if (!response.Item) {
        return null;
      }

      return {
        date: response.Item.date || date,
        requests: response.Item.requests || 0,
        resumesUploaded: response.Item.resumesUploaded || 0,
        resumesParsed: response.Item.resumesParsed || 0,
        parseFailures: response.Item.parseFailures || 0,
        inputTokens: response.Item.inputTokens || 0,
        outputTokens: response.Item.outputTokens || 0,
        totalTokens: response.Item.totalTokens || 0,
      };
    } catch (error: any) {
      logger.error('UsageRepository.getDailyUsage failed', {
        userId,
        date,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Queries daily usage counters for a date range [startDate, endDate].
   */
  static async getDailyUsageRange(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<DailyUsage[]> {
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }

    try {
      const results = await Promise.all(
        dates.map((date) => this.getDailyUsage(userId, date))
      );

      return results.filter((item): item is DailyUsage => item !== null);
    } catch (error: any) {
      logger.error('UsageRepository.getDailyUsageRange failed', {
        userId,
        startDate,
        endDate,
        errorCode: error.name || error.code,
      });
      throw error;
    }
  }

  /**
   * Records a granular resume event for audit/lifecycle tracking.
   */
  static async recordResumeUsage(usage: ResumeUsage): Promise<void> {
    const eventId = generateId('ev');
    const item = {
      ...usage,
      eventId,
      resumeId: `EVENT#${eventId}`,
      associatedResumeId: usage.resumeId,
      customerId: usage.userId,
      entityType: 'RESUME_EVENT',
    };

    try {
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: item,
        })
      );
    } catch (error: any) {
      logger.error('UsageRepository.recordResumeUsage failed', {
        userId: usage.userId,
        resumeId: usage.resumeId,
        errorCode: error.name || error.code,
      });
      // Non-blocking for primary user flow
    }
  }

  /**
   * Records token usage for an AI parse invocation.
   */
  static async recordTokenUsage(usage: TokenUsage): Promise<void> {
    const eventId = generateId('tok');
    const item = {
      ...usage,
      eventId,
      resumeId: `TOKEN#${eventId}`,
      associatedResumeId: usage.resumeId,
      customerId: usage.userId,
      entityType: 'TOKEN_EVENT',
    };

    try {
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: item,
        })
      );
    } catch (error: any) {
      logger.error('UsageRepository.recordTokenUsage failed', {
        userId: usage.userId,
        resumeId: usage.resumeId,
        errorCode: error.name || error.code,
      });
    }
  }

  /**
   * Records an API request usage event.
   */
  static async recordApiUsage(usage: ApiUsage): Promise<void> {
    const eventId = generateId('req');
    const item = {
      resumeId: `API_REQ#${eventId}`,
      customerId: usage.userId,
      entityType: 'API_EVENT',
      ...usage,
    };

    try {
      await dynamo.send(
        new PutCommand({
          TableName: env.DYNAMODB_TABLE_NAME,
          Item: item,
        })
      );
    } catch (error: any) {
      logger.error('UsageRepository.recordApiUsage failed', {
        userId: usage.userId,
        errorCode: error.name || error.code,
      });
    }
  }
}
