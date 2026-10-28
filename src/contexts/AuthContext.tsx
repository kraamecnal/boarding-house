import { createClient, type Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';

import { getSupabaseClient, isSupabaseConfigured } from '@/utils/supabase';

export type AuthMode = 'sign-in' | 'sign-up';

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  initializationError: string | null;
  requestMagicLink: (email: string, mode: AuthMode) => Promise<void>;
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

  const requestMagicLink = useCallback(async (email: string, mode: AuthMode) => {
  const configuredRedirect = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL?.trim();
  
  if (Platform.OS === 'web' && !__DEV__ && !configuredRedirect) {
    throw new Error(
      'Set EXPO_PUBLIC_AUTH_REDIRECT_URL to your production web callback URL before sending sign-in links.',
    );
  }


  const emailRedirectTo = configuredRedirect || Linking.createURL('auth/callback');

/* debugging snippet

  // 1. CHOOSE THE RIGHT LINK FOR EXPO GO VS PRODUCTION
  let emailRedirectTo = configuredRedirect;

  if (!emailRedirectTo) {
    if (__DEV__) {
      // 🔴 FORCE your exact Expo Go local IP network path:
      emailRedirectTo = 'exp://192.168.100.207:8081/--/auth/callback?_notrack=1'; 
    } else {
      emailRedirectTo = Linking.createURL('auth/callback');
    }
  }


  console.log("👉 ADD THIS EXACT STRING TO SUPABASE:", emailRedirectTo);

 end of debugging snippet */




  if (__DEV__) {
    console.info('Supabase magic-link redirect URI:', emailRedirectTo);
    if (!configuredRedirect) {
      console.warn(
        'EXPO_PUBLIC_AUTH_REDIRECT_URL is not set. Expo is using the current development callback; add that exact URI to Supabase Auth Redirect URLs.',
      );
    }
  }

  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: mode === 'sign-up',
      emailRedirectTo,
    },
  });
  
  if (error) throw error;
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
      value={{
        session,
        isLoading,
        initializationError,
        requestMagicLink,
        signOut,
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