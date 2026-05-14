import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!identifier || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    setStatus('Verifying credentials...');
    try {
      // Argon2 can take 1-2 seconds, so we show a status update
      await login(identifier.trim(), password, (msg: string) => setStatus(msg));
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Login Failed', e.message || 'An error occurred');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.glassPanel}>
        <View style={styles.header}>
          <ShieldCheck color="#66fcf1" size={48} />
          <Text style={styles.title}>Prama E2EE</Text>
          <Text style={styles.subtitle}>Secure Mobile Messaging</Text>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Username or Email</Text>
          <TextInput 
            style={styles.input}
            placeholder="Enter identifier"
            placeholderTextColor="#888"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput 
            style={styles.input}
            placeholder="Enter password"
            placeholderTextColor="#888"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        <TouchableOpacity 
          style={styles.button}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator color="#0b0c10" style={{ marginRight: 10 }} />
              <Text style={styles.buttonText}>{status || 'Please wait...'}</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>Login Securely</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.footerLink}>
          <Text style={styles.footerText}>Don't have an account? Sign Up</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0c10',
    justifyContent: 'center',
    padding: 20,
  },
  glassPanel: {
    backgroundColor: 'rgba(31, 40, 51, 0.8)',
    borderRadius: 20,
    padding: 30,
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.2)',
    shadowColor: '#66fcf1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#66fcf1',
    marginTop: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#c5c6c7',
    marginTop: 5,
  },
  inputContainer: {
    marginBottom: 30,
  },
  label: {
    color: '#66fcf1',
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: 'rgba(11, 12, 16, 0.5)',
    borderRadius: 10,
    padding: 15,
    color: '#fff',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  button: {
    backgroundColor: '#66fcf1',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    shadowColor: '#66fcf1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  buttonText: {
    color: '#0b0c10',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footerLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  footerText: {
    color: '#888',
    fontSize: 14,
  },
});
