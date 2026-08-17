export type UserStatus = 'active' | 'suspended';
export type UserPlan = 'free' | 'pro' | 'enterprise';

export interface User {
  userId: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  plan: UserPlan;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export interface Session {
  sessionId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export type ApiKeyEnvironment = 'live' | 'test';
export type ApiKeyStatus = 'active' | 'revoked';

export interface ApiKey {
  keyId: string;
  userId: string;
  name: string;
  keyPrefix: string;
  secretHash: string;
  environment: ApiKeyEnvironment;
  status: ApiKeyStatus;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface ApiKeySafe {
  id: string;
  name: string;
  keyPrefix: string;
  environment: ApiKeyEnvironment;
  status: ApiKeyStatus;
  createdAt: string;
  lastUsedAt?: string;
}

export interface UsageLimits {
  resumesPerMonth: number;
  apiRequestsPerMonth: number;
  maxFileSizeBytes: number;
}

export type AppEnv = {
  Variables: {
    user: User;
    apiKey?: ApiKey;
    session?: Session;
  };
};

