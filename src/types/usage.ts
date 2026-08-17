export type ResumeUsageEvent =
  | 'uploaded'
  | 'parse_started'
  | 'parse_completed'
  | 'parse_failed';

export interface ResumeUsage {
  resumeId: string;
  userId: string;
  apiKeyId?: string;
  event: ResumeUsageEvent;
  fileSize?: number;
  fileType?: string;
  processingTimeMs?: number;
  createdAt: string;
}

export interface TokenUsage {
  userId: string;
  apiKeyId?: string;
  resumeId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
}

export interface ApiUsage {
  userId: string;
  apiKeyId: string;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  createdAt: string;
}

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  requests: number;
  resumesUploaded: number;
  resumesParsed: number;
  parseFailures: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type UsagePeriod =
  | 'today'
  | '7d'
  | '30d'
  | 'current_month'
  | 'previous_month';

export interface UsageSummary {
  period: string;
  requests: number;
  resumesUploaded: number;
  resumesParsed: number;
  parseFailures: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
