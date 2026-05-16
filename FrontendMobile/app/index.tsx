import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { BiometricManager } from '../utils/BiometricManager';
import { ShieldCheck } from 'lucide-react-native';

/**
 * Entry Point Guard
 * Handles automatic redirection to either Biometric Unlock, Dashboard, or Login.
 */
export default function Index() {
  const router = useRouter();
  const { user, masterKey, loading: authLoading } = useAuth();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const handleEntry = async () => {
      // Wait for AuthContext to finish restoring session from standard SecureStore
      if (authLoading) return;

      try {
        const isBioSetup = await BiometricManager.isSetup();
        
        if (isBioSetup) {
          // Trigger Biometric Unlock Flow
          const unlockedKey = await BiometricManager.unlock();
          if (unlockedKey) {
            // Success: Navigate to the main app interface
            // The masterKey is already in memory via AuthContext if session restored,
            // or we could inject it here if we were handling state differently.
            // For Prama, AuthContext handles the 'user' state.
            router.replace('/(tabs)');
          } else {
            // Failure or Cancel: Force manual login
            router.replace('/login');
          }
        } else if (user) {
          // If logged in but no biometrics, go to main app
          router.replace('/(tabs)');
        } else {
          // Otherwise, go to login
          router.replace('/login');
        }
      } catch (e) {
        router.replace('/login');
      } finally {
        setChecking(false);
      }
    };

    handleEntry();
  }, [authLoading, user]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <ShieldCheck color="#66fcf1" size={80} />
        <ActivityIndicator size="large" color="#66fcf1" style={styles.loader} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0c10',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  loader: {
    marginTop: 30,
  },
});
