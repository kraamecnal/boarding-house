import { createClient, type Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { getSupabaseClient, isSupabaseConfigured } from '@/utils/supabase';

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  initializationError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  verifyPassword: (password: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [initializationError, setInitializationError] = useState<string | null>(null);

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

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const emailRedirectTo = Linking.createURL('auth/callback');
    if (__DEV__) {
      console.info('Supabase email confirmation redirect:', emailRedirectTo);
    }

    const { data, error } = await getSupabaseClient().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
      },
    });
    if (error) throw error;
    return Boolean(data.session);
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
  }, []);

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

  return (
    <AuthContext.Provider
      value={{ session, isLoading, initializationError, signIn, signUp, signOut, verifyPassword }}>
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