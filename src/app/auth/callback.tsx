import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseClient } from '@/utils/supabase';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();
  const router = useRouter();
  const { isLoading } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasHandledCallback = useRef(false);
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const authError = Array.isArray(params.error_description)
    ? params.error_description[0]
    : params.error_description;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const callbackError = authError || errorCode
    ? authError || `Email confirmation failed (${errorCode}).`
    : !isLoading && !code
      ? 'The confirmation link is incomplete or has expired. Request a new one.'
      : null;
  const displayedError = errorMessage ?? callbackError;

  useEffect(() => {
    if (isLoading || hasHandledCallback.current) return;
    hasHandledCallback.current = true;

    if (authError || errorCode || !code) return;

    const completeConfirmation = async () => {
      const client = getSupabaseClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;

      const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;

      router.replace('/sign-in?confirmed=1');
    };

    completeConfirmation().catch((error: unknown) => {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'We could not confirm your email. Request a new confirmation link.',
      );
    });
  }, [authError, code, errorCode, isLoading, router]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {displayedError ? (
          <>
            <Text style={styles.title}>Could not confirm email</Text>
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
            <ActivityIndicator size="large" color="#208AEF" />
            <Text style={styles.title}>Confirming your email</Text>
            <Text style={styles.message}>Please wait while we verify your confirmation link.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    color: '#14243A',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 20,
  },
  message: {
    color: '#667085',
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
    backgroundColor: '#208AEF',
    marginTop: 24,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
