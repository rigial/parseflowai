import { UsageRepository } from '../repositories/usage.repository';
import { LimitsService } from './limits.service';
import {
  getDateRangeForPeriod,
  getDatesBetween,
  getUtcDateString,
} from '../utils/time';
import type {
  DailyUsage,
  ResumeUsage,
  TokenUsage,
  UsagePeriod,
  UsageSummary,
} from '../types/usage';
import type { AiTokenUsage } from './ai.service';
import type { User } from '../types/auth';

export class UsageService {
  /**
   * Tracks a resume upload event and increments daily upload counters.
   */
  static async trackUpload(params: {
    userId: string;
    apiKeyId?: string;
    resumeId: string;
    fileSize?: number;
    fileType?: string;
  }): Promise<void> {
    const { userId, apiKeyId, resumeId, fileSize, fileType } = params;
    const now = new Date();
    const date = getUtcDateString(now);
    const createdAt = now.toISOString();

    // 1. Increment daily counter
    await UsageRepository.incrementDailyUsage(userId, date, {
      resumesUploaded: 1,
    });

    // 2. Record detailed event
    const resumeUsage: ResumeUsage = {
      resumeId,
      userId,
      apiKeyId,
      event: 'uploaded',
      fileSize,
      fileType,
      createdAt,
    };
    await UsageRepository.recordResumeUsage(resumeUsage);
  }

  /**
   * Tracks the start of a resume parsing attempt.
   */
  static async trackParseStarted(params: {
    userId: string;
    apiKeyId?: string;
    resumeId: string;
  }): Promise<void> {
    const { userId, apiKeyId, resumeId } = params;
    const now = new Date();
    const createdAt = now.toISOString();

    const resumeUsage: ResumeUsage = {
      resumeId,
      userId,
      apiKeyId,
      event: 'parse_started',
      createdAt,
    };
    await UsageRepository.recordResumeUsage(resumeUsage);
  }

  /**
   * Tracks successful parse completion, AI token consumption, and increments counters.
   */
  static async trackParseSuccess(params: {
    userId: string;
    apiKeyId?: string;
    resumeId: string;
    durationMs?: number;
    tokenUsage?: AiTokenUsage;
  }): Promise<void> {
    const { userId, apiKeyId, resumeId, durationMs, tokenUsage } = params;
    const now = new Date();
    const date = getUtcDateString(now);
    const createdAt = now.toISOString();

    const inputTokens = tokenUsage?.inputTokens || 0;
    const outputTokens = tokenUsage?.outputTokens || 0;
    const totalTokens = tokenUsage?.totalTokens || inputTokens + outputTokens;

    // 1. Increment daily counters
    await UsageRepository.incrementDailyUsage(userId, date, {
      resumesParsed: 1,
      inputTokens,
      outputTokens,
      totalTokens,
    });

    // 2. Record resume lifecycle event
    await UsageRepository.recordResumeUsage({
      resumeId,
      userId,
      apiKeyId,
      event: 'parse_completed',
      processingTimeMs: durationMs,
      createdAt,
    });

    // 3. Record AI token usage event if available
    if (tokenUsage) {
      const tokenRecord: TokenUsage = {
        userId,
        apiKeyId,
        resumeId,
        provider: tokenUsage.provider,
        model: tokenUsage.model,
        inputTokens,
        outputTokens,
        totalTokens,
        createdAt,
      };
      await UsageRepository.recordTokenUsage(tokenRecord);
    }
  }

  /**
   * Tracks a parse failure event and increments failure counter.
   */
  static async trackParseFailure(params: {
    userId: string;
    apiKeyId?: string;
    resumeId: string;
    durationMs?: number;
  }): Promise<void> {
    const { userId, apiKeyId, resumeId, durationMs } = params;
    const now = new Date();
    const date = getUtcDateString(now);
    const createdAt = now.toISOString();

    // 1. Increment daily failure counter
    await UsageRepository.incrementDailyUsage(userId, date, {
      parseFailures: 1,
    });

    // 2. Record event
    await UsageRepository.recordResumeUsage({
      resumeId,
      userId,
      apiKeyId,
      event: 'parse_failed',
      processingTimeMs: durationMs,
      createdAt,
    });
  }

  /**
   * Tracks an API request and increments request counters.
   */
  static async trackApiRequest(params: {
    userId: string;
    apiKeyId: string;
    route: string;
    method: string;
    statusCode: number;
    durationMs: number;
  }): Promise<void> {
    const { userId, apiKeyId, route, method, statusCode, durationMs } = params;
    const now = new Date();
    const date = getUtcDateString(now);
    const createdAt = now.toISOString();

    await UsageRepository.incrementDailyUsage(userId, date, {
      requests: 1,
    });

    await UsageRepository.recordApiUsage({
      userId,
      apiKeyId,
      route,
      method,
      statusCode,
      durationMs,
      createdAt,
    });
  }

  /**
   * Aggregates usage summary metrics for a given time period.
   */
  static async getUsageSummary(
    userId: string,
    period: UsagePeriod = 'current_month'
  ): Promise<UsageSummary> {
    const { startDate, endDate } = getDateRangeForPeriod(period);
    const dailyRecords = await UsageRepository.getDailyUsageRange(
      userId,
      startDate,
      endDate
    );

    const summary: UsageSummary = {
      period,
      requests: 0,
      resumesUploaded: 0,
      resumesParsed: 0,
      parseFailures: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    for (const record of dailyRecords) {
      summary.requests += record.requests || 0;
      summary.resumesUploaded += record.resumesUploaded || 0;
      summary.resumesParsed += record.resumesParsed || 0;
      summary.parseFailures += record.parseFailures || 0;
      summary.inputTokens += record.inputTokens || 0;
      summary.outputTokens += record.outputTokens || 0;
      summary.totalTokens += record.totalTokens || 0;
    }

    return summary;
  }

  /**
   * Retrieves a daily breakdown of usage over a given period.
   */
  static async getDailyBreakdown(
    userId: string,
    period: UsagePeriod = 'current_month'
  ): Promise<{ daily: Array<{ date: string; requests: number; resumesParsed: number; tokens: number }> }> {
    const { startDate, endDate } = getDateRangeForPeriod(period);
    const dailyRecords = await UsageRepository.getDailyUsageRange(
      userId,
      startDate,
      endDate
    );

    const map = new Map<string, DailyUsage>();
    for (const rec of dailyRecords) {
      map.set(rec.date, rec);
    }

    const allDates = getDatesBetween(startDate, endDate);
    const daily = allDates.map((date) => {
      const rec = map.get(date);
      return {
        date,
        requests: rec ? rec.requests : 0,
        resumesParsed: rec ? rec.resumesParsed : 0,
        tokens: rec ? rec.totalTokens : 0,
      };
    });

    return { daily };
  }

  /**
   * Verifies if user is within their monthly usage limits.
   */
  static async checkMonthlyQuota(
    user: User,
    action: 'upload' | 'request'
  ): Promise<{ allowed: boolean; limit: number; currentCount: number }> {
    const monthlySummary = await this.getUsageSummary(user.userId, 'current_month');
    const currentCount =
      action === 'upload'
        ? monthlySummary.resumesUploaded
        : monthlySummary.requests;

    return LimitsService.checkQuota(user.plan || 'free', action, currentCount);
  }
}
