import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import AnimatedButton from '@/components/AnimatedButton';
import { useAuth } from '@/contexts/AuthContext';
import { boardingHouseList } from '@/data/boardingHouses';

export default function IndexScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error: unknown) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out. Try again.');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.accountHeader}>
        <View>
          <Text style={styles.welcomeText}>HELLO</Text>
          <Text style={styles.emailText}>{session?.user.email}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={isSigningOut}
          onPress={handleSignOut}
          style={styles.signOutButton}>
          {isSigningOut ? (
            <ActivityIndicator size="small" color="#1A2B3C" />
          ) : (
            <Text style={styles.signOutText}>Sign out</Text>
          )}
        </Pressable>
      </View>
      {signOutError && <Text style={styles.errorText}>{signOutError}</Text>}
      {boardingHouseList.map((house) => (
        <AnimatedButton
          key={house.id}
          label={house.name}
          onPress={() => router.push(`/bh/${house.id}`)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'white',
    paddingHorizontal: 24,
  },
  accountHeader: {
    width: '100%',
    maxWidth: 440,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  welcomeText: {
    color: '#1A2B3C',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 2,
  },
  emailText: {
    color: '#60646C',
    fontSize: 14,
    marginTop: 4,
  },
  signOutButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#F0F0F3',
  },
  signOutText: {
    color: '#1A2B3C',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: '#B42318',
    fontSize: 13,
  },
});