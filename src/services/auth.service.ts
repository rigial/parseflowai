import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import {
  generateId,
  generateSessionId,
  hashPassword,
  verifyPassword,
} from '../utils/crypto';
import type { SafeUser, Session, User } from '../types/auth';
import type { LoginInput, SignupInput } from '../schemas/auth.schema';

export class AuthService {
  /**
   * Registers a new user account.
   */
  static async signup(input: SignupInput): Promise<{ user: SafeUser }> {
    const email = input.email.toLowerCase().trim();
    const existing = await UserRepository.getUserByEmail(email);
    if (existing) {
      const err = new Error('Email already registered');
      err.name = 'EmailAlreadyExistsError';
      throw err;
    }

    const now = new Date().toISOString();
    const userId = generateId('usr');
    const passwordHash = hashPassword(input.password);

    const newUser: User = {
      userId,
      email,
      passwordHash,
      status: 'active',
      plan: 'free',
      createdAt: now,
      updatedAt: now,
    };

    await UserRepository.createUser(newUser);

    return {
      user: {
        userId: newUser.userId,
        email: newUser.email,
        status: newUser.status,
        plan: newUser.plan,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt,
      },
    };
  }

  /**
   * Authenticates a user, verifies credentials, and creates a session.
   */
  static async login(
    input: LoginInput
  ): Promise<{ user: SafeUser; session: Session }> {
    const email = input.email.toLowerCase().trim();
    const user = await UserRepository.getUserByEmail(email);

    if (!user) {
      const err = new Error('Invalid email or password');
      err.name = 'InvalidCredentialsError';
      throw err;
    }

    if (user.status !== 'active') {
      const err = new Error('Account is suspended');
      err.name = 'AccountSuspendedError';
      throw err;
    }

    const isValidPassword = verifyPassword(input.password, user.passwordHash);
    if (!isValidPassword) {
      const err = new Error('Invalid email or password');
      err.name = 'InvalidCredentialsError';
      throw err;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    // 30-day session expiry
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = generateSessionId();

    const session: Session = {
      sessionId,
      userId: user.userId,
      createdAt: nowIso,
      expiresAt,
    };

    await SessionRepository.createSession(session);
    await UserRepository.updateLastLogin(user.userId, nowIso);

    return {
      user: {
        userId: user.userId,
        email: user.email,
        status: user.status,
        plan: user.plan,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: nowIso,
      },
      session,
    };
  }

  /**
   * Terminates a session.
   */
  static async logout(sessionId: string): Promise<void> {
    await SessionRepository.deleteSession(sessionId);
  }

  /**
   * Validates a session token and returns the authenticated user.
   */
  static async validateSession(
    sessionId: string
  ): Promise<{ user: User; session: Session } | null> {
    if (!sessionId) {
      return null;
    }

    const session = await SessionRepository.getSession(sessionId);
    if (!session) {
      return null;
    }

    const user = await UserRepository.getUserById(session.userId);
    if (!user || user.status !== 'active') {
      return null;
    }

    return { user, session };
  }
}
