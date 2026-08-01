import { createContext, useContext, useEffect, useState } from 'react';
import { auth, LocalUser } from '@/integrations/indexeddb/auth';
import { notifyDatabaseChanged } from '@/utils/dbSync';

interface LocalSession {
  user: LocalUser;
  expires_at: string;
}

interface AuthContextType {
  user: LocalUser | null;
  session: LocalSession | null;
  loading: boolean;
  hasPinSet: boolean;          // false → show "Set your PIN" screen
  hasAccount: boolean;         // false → show signup screen
  signUp: (email: string, phone: string, pin: string) => Promise<any>;
  signIn: (pin: string, email?: string) => Promise<any>;
  signOut: () => Promise<any>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,       setUser]       = useState<LocalUser | null>(null);
  const [session,    setSession]    = useState<LocalSession | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [hasPinSet,  setHasPinSet]  = useState(true);   // optimistic — corrected after load
  const [hasAccount, setHasAccount] = useState(false);

  const refreshUser = async () => {
    setLoading(true);
    const { user: currentUser } = await auth.getCurrentUserLocal();
    const accountExists         = await auth.hasLocalAccount();
    const pinSet                = await auth.hasPinSet();

    setUser(currentUser);
    setHasAccount(accountExists);
    setHasPinSet(pinSet);

    if (currentUser) {
      setSession({
        user: currentUser,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    } else {
      setSession(null);
    }

    setLoading(false);
    notifyDatabaseChanged();
  };

  useEffect(() => { refreshUser(); }, []);

  const signUp = async (email: string, phone: string, pin: string) => {
    const { user: newUser, error } = await auth.signUpLocal(email, phone, pin);
    if (error) throw new Error(error);
    await refreshUser();
    return { user: newUser };
  };

  const signIn = async (pin: string, email?: string) => {
    const { user: signedInUser, error } = await auth.signInWithPin(pin, email);
    if (error) throw new Error(error);
    await refreshUser();
    return { user: signedInUser };
  };

  const signOut = async () => {
    const { error } = await auth.signOutLocal();
    if (error) throw new Error(error);
    setUser(null);
    setSession(null);
    notifyDatabaseChanged();
  };

  return (
    <AuthContext.Provider value={{
      user, session, loading, hasPinSet, hasAccount,
      signUp, signIn, signOut, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
