import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth, AuthProvider } from '../context/AuthContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, View, ActivityIndicator } from 'react-native';

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync();
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      console.log("🚀 RootLayout: Auth loaded, hiding splash...");
      SplashScreen.hideAsync().catch(console.error);
    }
  }, [loading]);

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
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutContent />
    </AuthProvider>
  );
}
