import type { MyDB } from './db';
import { getAll, getAllByIndex, get, put } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

type ProfileRecord = MyDB['profiles']['value'];

const BCRYPT_SALT_ROUNDS = 10;
const SESSION_KEY = 'local_auth_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocalUser {
  id: string;
  email: string;
  phone: string;
  display_name: string;   // optional, set during onboarding
  pin_hash: string;       // empty string = PIN not yet set (existing users post-migration)
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

interface LocalSession {
  user: LocalUser;
  expires_at: string;
}

// ─── Session helpers ──────────────────────────────────────────────────────────

let currentSession: LocalSession | null = null;

function getSessionFromStorage(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: LocalSession = JSON.parse(raw);
    if (new Date(session.expires_at) > new Date()) return session;
    localStorage.removeItem(SESSION_KEY);
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
  return null;
}

function saveSessionToStorage(session: LocalSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function buildUserFromRecord(record: MyDB['profiles']['value']): LocalUser {
  return {
    id:                   record.id,
    email:                record.email,
    phone:                record.phone,
    display_name:         (record as any).display_name  ?? '',
    pin_hash:             (record as any).pin_hash       ?? '',
    onboarding_completed: record.onboarding_completed,
    created_at:           record.created_at,
    updated_at:           record.updated_at,
  };
}

// Initialise session on module load
currentSession = getSessionFromStorage();

// ─── Auth service ─────────────────────────────────────────────────────────────

export const auth = {

  // ── Sign up ────────────────────────────────────────────────────────────────
  async signUpLocal(
    email: string,
    phone: string,
    pin: string,
  ): Promise<{ user: LocalUser | null; error: string | null }> {
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    if (!/^\d{4}$/.test(pin)) {
      return { user: null, error: 'PIN must be exactly 4 digits.' };
    }

    const pinHash = await bcrypt.hash(pin, BCRYPT_SALT_ROUNDS);

    // `profiles.email` was a UNIQUE IndexedDB index; the repository does not
    // enforce uniqueness, so this pre-check is the only thing stopping two
    // accounts from sharing an email.
    const existingByEmail = await getAllByIndex<ProfileRecord>('profiles', 'email', trimmedEmail);
    if (existingByEmail.length > 0) {
      return { user: null, error: 'An account with this email already exists.' };
    }

    const now = new Date().toISOString();
    const newRecord: ProfileRecord = {
      id:                   uuidv4(),
      email:                trimmedEmail,
      phone:                trimmedPhone,
      pin_hash:             pinHash,
      display_name:         '',
      onboarding_completed: false,
      created_at:           now,
      updated_at:           now,
    } as any;

    await put('profiles', newRecord);

    const user = buildUserFromRecord(newRecord);
    const session: LocalSession = {
      user,
      expires_at: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    };
    currentSession = session;
    saveSessionToStorage(session);

    return { user, error: null };
  },

  // ── Sign in with PIN ───────────────────────────────────────────────────────
  // Finds the single local profile and verifies the PIN.
  // On a shared/family device with multiple accounts, we look up by email first.
  // For the standard single-user case, we just get the first profile.
  async signInWithPin(
    pin: string,
    email?: string,
  ): Promise<{ user: LocalUser | null; error: string | null }> {
    if (!/^\d{4}$/.test(pin)) {
      return { user: null, error: 'PIN must be exactly 4 digits.' };
    }

    let record: ProfileRecord | undefined;

    if (email) {
      const matches = await getAllByIndex<ProfileRecord>('profiles', 'email', email.trim());
      record = matches[0];
    } else {
      // Single-user app — get the first (and typically only) profile
      const all = await getAll<ProfileRecord>('profiles');
      record = all[0];
    }

    if (!record) {
      return { user: null, error: 'No account found. Please sign up first.' };
    }

    const pinHash = (record as any).pin_hash ?? '';
    if (!pinHash) {
      // Existing user who hasn't set a PIN yet (migrated from old auth)
      return { user: null, error: 'PIN_NOT_SET' };
    }

    const match = await bcrypt.compare(pin, pinHash);
    if (!match) {
      return { user: null, error: 'Incorrect PIN. Please try again.' };
    }

    const user = buildUserFromRecord(record);
    const session: LocalSession = {
      user,
      expires_at: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    };
    currentSession = session;
    saveSessionToStorage(session);

    return { user, error: null };
  },

  // ── Sign out ───────────────────────────────────────────────────────────────
  async signOutLocal(): Promise<{ error: string | null }> {
    currentSession = null;
    localStorage.removeItem(SESSION_KEY);
    return { error: null };
  },

  // ── Get current user ───────────────────────────────────────────────────────
  async getCurrentUserLocal(): Promise<{ user: LocalUser | null; error: string | null }> {
    if (currentSession && new Date(currentSession.expires_at) > new Date()) {
      return { user: currentSession.user, error: null };
    }
    const session = getSessionFromStorage();
    if (session) {
      currentSession = session;
      return { user: session.user, error: null };
    }
    return { user: null, error: null };
  },

  // ── Check if any local account exists ─────────────────────────────────────
  async hasLocalAccount(): Promise<boolean> {
    const all = await getAll<ProfileRecord>('profiles');
    return all.length > 0;
  },

  // ── Check if the existing account has a PIN set ───────────────────────────
  async hasPinSet(): Promise<boolean> {
    const all = await getAll<ProfileRecord>('profiles');
    if (all.length === 0) return false;
    return !!((all[0] as any).pin_hash);
  },

  // ── Set / update PIN (used for first-time PIN set and PIN reset) ───────────
  async updateUserPinLocal(
    userId: string,
    newPin: string,
  ): Promise<{ error: string | null }> {
    if (!/^\d{4}$/.test(newPin)) {
      return { error: 'PIN must be exactly 4 digits.' };
    }
    try {
      const pinHash = await bcrypt.hash(newPin, BCRYPT_SALT_ROUNDS);
      const record = await get<ProfileRecord>('profiles', userId);
      if (!record) { return { error: 'User not found.' }; }

      const updated = { ...record, pin_hash: pinHash, updated_at: new Date().toISOString() };
      await put('profiles', updated as any);

      // Update session
      if (currentSession?.user.id === userId) {
        const updatedUser = buildUserFromRecord(updated as any);
        currentSession = { ...currentSession, user: updatedUser };
        saveSessionToStorage(currentSession);
      }
      return { error: null };
    } catch (e: any) {
      return { error: e.message ?? 'Failed to update PIN.' };
    }
  },

  // ── Update display name ────────────────────────────────────────────────────
  async updateUserProfileLocal(
    userId: string,
    updates: { display_name?: string; phone?: string },
  ): Promise<{ user: LocalUser | null; error: string | null }> {
    const record = await get<ProfileRecord>('profiles', userId);
    if (!record) { return { user: null, error: 'User not found.' }; }

    const updated = { ...record, ...updates, updated_at: new Date().toISOString() };
    await put('profiles', updated as any);

    const user = buildUserFromRecord(updated as any);
    if (currentSession?.user.id === userId) {
      currentSession = { ...currentSession, user };
      saveSessionToStorage(currentSession);
    }
    return { user, error: null };
  },

  // ── Update email ───────────────────────────────────────────────────────────
  async updateUserEmailLocal(
    userId: string,
    newEmail: string,
  ): Promise<{ user: LocalUser | null; error: string | null }> {
    const trimmed = newEmail.trim();

    // `profiles.email` was a UNIQUE IndexedDB index; the repository does not
    // enforce uniqueness, so this pre-check must stay.
    const matches = await getAllByIndex<ProfileRecord>('profiles', 'email', trimmed);
    const existing = matches[0];
    if (existing && existing.id !== userId) {
      return { user: null, error: 'Email already in use by another account.' };
    }

    const record = await get<ProfileRecord>('profiles', userId);
    if (!record) { return { user: null, error: 'User not found.' }; }

    const updated = { ...record, email: trimmed, updated_at: new Date().toISOString() };
    await put('profiles', updated as any);

    const user = buildUserFromRecord(updated as any);
    if (currentSession?.user.id === userId) {
      currentSession = { ...currentSession, user };
      saveSessionToStorage(currentSession);
    }
    return { user, error: null };
  },

  // ── Get user profile ───────────────────────────────────────────────────────
  async getUserProfileLocal(
    userId: string,
  ): Promise<{ profile: LocalUser | null; error: string | null }> {
    const record = await get<ProfileRecord>('profiles', userId);
    if (!record) return { profile: null, error: 'User not found.' };
    return { profile: buildUserFromRecord(record as any), error: null };
  },

  // ── Verify by email + phone (for PIN reset) ────────────────────────────────
  async verifyUserByEmailAndPhone(
    email: string,
    phone: string,
  ): Promise<{ user: LocalUser | null; error: string | null }> {
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const matches = await getAllByIndex<ProfileRecord>('profiles', 'email', trimmedEmail);
    const record = matches[0];

    if (!record) return { user: null, error: 'No account found with this email.' };
    if (record.phone !== trimmedPhone) {
      return { user: null, error: 'Phone number does not match.' };
    }
    return { user: buildUserFromRecord(record as any), error: null };
  },

  // ── Mark onboarding completed ─────────────────────────────────────────────
  async markOnboardingCompletedLocal(
    userId: string,
  ): Promise<{ error: string | null }> {
    const record = await get<ProfileRecord>('profiles', userId);
    if (!record) { return { error: 'User not found.' }; }

    const updated = { ...record, onboarding_completed: true, updated_at: new Date().toISOString() };
    await put('profiles', updated);

    if (currentSession?.user.id === userId) {
      currentSession = {
        ...currentSession,
        user: { ...currentSession.user, onboarding_completed: true },
      };
      saveSessionToStorage(currentSession);
    }
    return { error: null };
  },

  // ── Create session directly by userId (used after CSV restore) ────────────
  // Identity has already been verified via email+phone+CSV match — no PIN needed.
  async createSessionForUser(
    userId: string,
  ): Promise<{ user: LocalUser | null; error: string | null }> {
    const record = await get<ProfileRecord>('profiles', userId);
    if (!record) return { user: null, error: 'User not found.' };
    const user    = buildUserFromRecord(record as any);
    const session: LocalSession = {
      user,
      expires_at: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    };
    currentSession = session;
    saveSessionToStorage(session);
    return { user, error: null };
  },
};
