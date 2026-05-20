import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck, ArrowLeft, Globe } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { API_BASE_URL } from '../../constants/Config';

export default function SignupScreen() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSecureAuthSession = async () => {
    setLoading(true);
    const redirectUrl = Linking.createURL('auth');
    const webOrigin = API_BASE_URL.replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');
    const webAuthUrl = `${webOrigin}/?tab=register&redirect_uri=${encodeURIComponent(redirectUrl)}`;

    try {
      console.log("🎯 [AuthSession] Launching WebBrowser session with URL:", webAuthUrl);
      const result = await WebBrowser.openAuthSessionAsync(webAuthUrl, redirectUrl);

      if (result.type === 'success') {
        console.log("🎯 [AuthSession] Handoff complete! Redirect URI:", result.url);
        
        // 🚀 Staff-Level Pro-Tip: Defensive String-Parsing Fallback to bypass SDK version issues
        const url = result.url;
        const statusMatch = url.split('#')[1]?.split('&').find(p => p.startsWith('status='));
        const status = statusMatch ? statusMatch.split('=')[1] : null;
        
        if (status === 'success') {
          Alert.alert(
            'Success',
            'Account successfully registered! You can now log in.',
            [{ text: 'OK', onPress: () => router.replace('/login') }]
          );
        } else {
          Alert.alert('Registration Cancelled', 'The secure session did not complete successfully.');
        }
      }
    } catch (e: any) {
      Alert.alert('Session Failed', e.message || 'Could not establish secure authentication session.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.glassPanel}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft color="#66fcf1" size={24} />
          </TouchableOpacity>

          <View style={styles.header}>
            <ShieldCheck color="#66fcf1" size={48} />
            <Text style={styles.title}>Join Prama</Text>
            <Text style={styles.subtitle}>Hardware Cryptographic Guard Active</Text>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              To guarantee absolute E2EE cryptographic safety and protect hardware resources, account registration and public-key pair creation must be executed inside a sandboxed WebKit engine.
            </Text>
            <Text style={styles.subInfoText}>
              Your mobile secure companion will automatically capture your session and return you here once created.
            </Text>
          </View>

          <TouchableOpacity 
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSecureAuthSession}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0b0c10" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Globe color="#0b0c10" size={20} />
                <Text style={styles.buttonText}>Launch Secure Signup</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.footerLink} onPress={() => router.back()}>
            <Text style={styles.footerText}>Already have an account? Log In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0c10',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  glassPanel: {
    backgroundColor: 'rgba(31, 40, 51, 0.8)',
    borderRadius: 20,
    padding: 30,
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.2)',
  },
  backButton: {
    position: 'absolute',
    top: 20,
    left: 20,
    zIndex: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: 25,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#66fcf1',
    marginTop: 10,
  },
  subtitle: {
    fontSize: 13,
    color: '#45a29e',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginTop: 6,
  },
  infoBox: {
    backgroundColor: 'rgba(11, 12, 16, 0.6)',
    borderRadius: 15,
    padding: 20,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  infoText: {
    color: '#c5c6c7',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 12,
  },
  subInfoText: {
    color: '#888',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#66fcf1',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#0b0c10',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  footerLink: {
    marginTop: 25,
    alignItems: 'center',
  },
  footerText: {
    color: '#888',
    fontSize: 14,
  },
});
