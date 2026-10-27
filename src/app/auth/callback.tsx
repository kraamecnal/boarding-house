import type { Session } from '@supabase/supabase-js';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseClient } from '@/utils/supabase';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
  }>();
  const router = useRouter();
  const { isLoading } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasHandledCallback = useRef(false);
  const code = firstParam(params.code);
  const tokenHash = firstParam(params.token_hash);
  const otpType = firstParam(params.type);
  const authError = firstParam(params.error_description);
  const errorCode = firstParam(params.error);
  const hasCallbackCredential = Boolean(code || tokenHash);
  const callbackError = authError || errorCode
    ? authError || `The email link could not be verified (${errorCode}).`
    : !isLoading && !hasCallbackCredential
      ? 'This email link is incomplete or expired. Request a new sign-in link.'
      : !isLoading && tokenHash && !otpType
        ? 'This email link is missing its verification type. Request a new link.'
        : null;
  const displayedError = errorMessage ?? callbackError;

  useEffect(() => {
    if (isLoading || hasHandledCallback.current) return;
    if (authError || errorCode || (!code && !tokenHash)) return;
    if (tokenHash && !otpType) return;

    hasHandledCallback.current = true;

    const completeSignIn = async () => {
      const client = getSupabaseClient();
      let session: Session | null;
      if (code) {
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw error;
        session = data.session;
      } else {
        if (!tokenHash || !otpType) {
          throw new Error('This email link is missing its verification details.');
        }
        const { data, error } = await client.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType,
        });
        if (error) throw error;
        session = data.session;
      }

      if (!session) {
        throw new Error('The email link was accepted, but no sign-in session was created.');
      }

      router.replace('/(tabs)');
    };

    completeSignIn().catch((error: unknown) => {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'We could not verify this email link. Request a new sign-in link.',
      );
    });
  }, [authError, code, errorCode, isLoading, otpType, router, tokenHash]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {displayedError ? (
          <>
            <Text style={styles.title}>Could not sign in</Text>
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {displayedError}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/sign-in')}
              style={styles.button}>
              <Text style={styles.buttonText}>Return to sign in</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={DashboardColors.primary} />
            <Text style={styles.title}>Verifying your email</Text>
            <Text style={styles.message}>Please wait while we securely sign you in.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DashboardColors.pale,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    color: DashboardColors.dark,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 20,
  },
  message: {
    color: DashboardColors.neutral,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: DashboardColors.primary,
    marginTop: 24,
  },
  buttonText: {
    color: DashboardColors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
