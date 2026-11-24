import { createClient, type Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { removeExpoPushToken } from '@/utils/notifications';
import { getSupabaseClient, isSupabaseConfigured } from '@/utils/supabase';

export type AuthMode = 'sign-in' | 'sign-up';

export type OwnerProfile = {
  fullName: string | null;
  email: string | null;
};

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  initializationError: string | null;
  ownerProfile: OwnerProfile | null;
  ownerDisplayName: string;
  ownerProfileError: string | null;
  reloadOwnerProfile: () => Promise<void>;
  applyOwnerProfileUpdate: (profile: OwnerProfile) => void;
  requestEmailOtp: (email: string, mode: AuthMode) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** True once the user has created the password that confirms bill payments. */
  hasPaymentPassword: boolean;
  setPaymentPassword: (password: string) => Promise<void>;
  verifyPassword: (password: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [ownerProfileState, setOwnerProfileState] = useState<{
    ownerId: string;
    profile: OwnerProfile;
  } | null>(null);
  const [ownerProfileError, setOwnerProfileError] = useState<string | null>(null);
  const ownerProfileRequest = useRef(0);
  const ownerId = session?.user.id;

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let isMounted = true;
    const client = getSupabaseClient();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setInitializationError(error.message);
        } else {
          setSession(data.session);
        }
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setInitializationError(
          error instanceof Error ? error.message : 'Unable to restore your session.',
        );
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const reloadOwnerProfile = useCallback(async () => {
    const requestId = ++ownerProfileRequest.current;
    if (!ownerId) {
      setOwnerProfileState(null);
      setOwnerProfileError(null);
      return;
    }

    setOwnerProfileError(null);
    try {
      const { data, error } = await getSupabaseClient()
        .from('owner_profile')
        .select('full_name, email_address')
        .eq('id', ownerId)
        .single();

      if (requestId !== ownerProfileRequest.current) return;
      if (error) throw error;

      setOwnerProfileState({
        ownerId,
        profile: {
          fullName: data.full_name ?? null,
          email: data.email_address ?? null,
        },
      });
    } catch (error: unknown) {
      if (requestId !== ownerProfileRequest.current) return;
      setOwnerProfileError(
        error instanceof Error ? error.message : 'Could not load your owner profile.',
      );
    }
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId) {
      ownerProfileRequest.current += 1;
      setOwnerProfileState(null);
      setOwnerProfileError(null);
      return;
    }

    void reloadOwnerProfile();
    return () => {
      ownerProfileRequest.current += 1;
    };
  }, [ownerId, reloadOwnerProfile]);

  const applyOwnerProfileUpdate = useCallback(
    (profile: OwnerProfile) => {
      if (!ownerId) throw new Error('Your signed-in owner account could not be identified.');
      ownerProfileRequest.current += 1;
      setOwnerProfileState({ ownerId, profile });
      setOwnerProfileError(null);
    },
    [ownerId],
  );

  const ownerProfile =
    ownerProfileState && ownerProfileState.ownerId === ownerId
      ? ownerProfileState.profile
      : null;
  const savedName = normalizeOwnerName(ownerProfile?.fullName);
  const email = session?.user.email?.trim() ?? '';
  const emailFallback = email.split('@')[0]?.trim();
  const ownerDisplayName = savedName ?? (emailFallback || 'Admin');

  const requestEmailOtp = useCallback(async (email: string, mode: AuthMode) => {
    const { error } = await getSupabaseClient().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: mode === 'sign-up',
      },
    });

    if (error) throw error;
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, token: string) => {
    const { data, error } = await getSupabaseClient().auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error) throw error;
    if (!data.session) {
      throw new Error('The code was accepted, but no sign-in session was created.');
    }
  }, []);






  const signOut = useCallback(async () => {
    if (session?.user.id) {
      try {
        await removeExpoPushToken(session.user.id);
      } catch {
        throw new Error(
          'Could not turn off phone alerts. Check your internet connection and try signing out again.',
        );
      }
    }
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
  }, [session]);

  /**
   * Checks the current user's password without touching the real session.
   * A throwaway client (no storage, no auto-refresh) signs in with the same
   * email, so the main client's session and auth listener are never affected.
   * Resolves false for a wrong password; throws for network/other errors.
   */
  const verifyPassword = useCallback(
    async (password: string) => {
      const email = session?.user.email;
      const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!email || !url || !key) {
        throw new Error('Unable to verify your password right now.');
      }

      const verifier = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: 'inkeeper-password-check',
        },
      });
      const { error } = await verifier.auth.signInWithPassword({ email, password });
      if (!error) return true;
      if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
        return false;
      }
      throw error;
    },
    [session],
  );

  // Email OTP is the app's sign-in flow, but this password is stored as the
  // Supabase Auth account password and also confirms bill payments.
  const hasPaymentPassword = session?.user.user_metadata?.payment_password_set === true;

  const setPaymentPassword = useCallback(async (password: string) => {
    const { error } = await getSupabaseClient().auth.updateUser({
      password,
      data: { payment_password_set: true },
    });
    if (error) throw error;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        initializationError,
        ownerProfile,
        ownerDisplayName,
        ownerProfileError,
        reloadOwnerProfile,
        applyOwnerProfileUpdate,
        requestEmailOtp,
        verifyEmailOtp,
        signOut,
        hasPaymentPassword,
        setPaymentPassword,
        verifyPassword,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}

export function normalizeOwnerName(fullName: string | null | undefined): string | null {
  const name = fullName?.trim();
  return name && name.toLowerCase() !== 'null' ? name : null;
}