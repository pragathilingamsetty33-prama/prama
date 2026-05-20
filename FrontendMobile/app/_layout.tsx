import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth, AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { WebSocketProvider } from '../context/WebSocketContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, AppStateStatus, Platform, View, ActivityIndicator } from 'react-native';
import { runStorageScavengerSweep } from '../utils/StorageScavenger';

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(console.error);
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(console.error);
    }
  }, [loading]);

  useEffect(() => {
    // 🧹 Operation 3 Scavenger daemon: Cold boot sweep
    runStorageScavengerSweep().catch(console.error);

    // Bind daemon sweep to React Native AppState hot-resume transitions
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        runStorageScavengerSweep().catch(console.error);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colorScheme === 'dark' ? '#000' : '#fff' }}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="admin/telemetry" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <WebSocketProvider>
          <RootLayoutContent />
        </WebSocketProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
