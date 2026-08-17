import type { UsageLimits, UserPlan } from '../types/auth';

export const PLAN_LIMITS: Record<UserPlan, UsageLimits> = {
  free: {
    resumesPerMonth: 50,
    apiRequestsPerMonth: 1000,
    maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
  },
  pro: {
    resumesPerMonth: 500,
    apiRequestsPerMonth: 10000,
    maxFileSizeBytes: 15 * 1024 * 1024, // 15MB
  },
  enterprise: {
    resumesPerMonth: 5000,
    apiRequestsPerMonth: 100000,
    maxFileSizeBytes: 25 * 1024 * 1024, // 25MB
  },
};

export class LimitsService {
  /**
   * Retrieves plan limits based on user tier.
   */
  static getPlanLimits(plan: UserPlan = 'free'): UsageLimits {
    return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  }

  /**
   * Checks if an action is within quota for the current month.
   */
  static checkQuota(
    plan: UserPlan,
    action: 'upload' | 'request',
    currentCount: number
  ): { allowed: boolean; limit: number; currentCount: number } {
    const limits = this.getPlanLimits(plan);
    const limit =
      action === 'upload'
        ? limits.resumesPerMonth
        : limits.apiRequestsPerMonth;

    return {
      allowed: currentCount < limit,
      limit,
      currentCount,
    };
  }
}
