import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'expo-router';
import { ShieldCheck, Activity, Wifi, Bug, X, Terminal } from 'lucide-react-native';
import { API_BASE_URL } from '../constants/Config';

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [showConsole, setShowConsole] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const { login } = useAuth();
  const router = useRouter();

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 50));
  };

  const handleLogin = async () => {
    if (!identifier || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    setStatus('Verifying credentials...');
    addLog(`Attempting login for: ${identifier}`);
    try {
      // Argon2 can take 1-2 seconds, so we show a status update
      await login(identifier.trim(), password, (msg: string) => {
        setStatus(msg);
        addLog(msg);
      });
      addLog("Login Success!");
      router.replace('/(tabs)');
    } catch (e: any) {
      addLog(`LOGIN ERROR: ${e.message}`);
      Alert.alert('Login Failed', e.message || 'An error occurred');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  const testConnection = async () => {
    addLog(`TESTING CONNECTION TO: ${API_BASE_URL}`);
    try {
      const start = Date.now();
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/health`, { 
        method: 'GET',
      });
      const duration = Date.now() - start;
      if (res.ok) {
        addLog(`SUCCESS: Backend reached in ${duration}ms`);
        Alert.alert('Success!', `Connected to Prama Backend in ${duration}ms\n\nIP: ${API_BASE_URL}`);
      } else {
        addLog(`FAILED: Status ${res.status}`);
        Alert.alert('Partial Success', `Reached laptop, but backend returned error ${res.status}\n\nIP: ${API_BASE_URL}`);
      }
    } catch (e: any) {
      addLog(`CONNECTION ERROR: ${e.message}`);
      Alert.alert('Connection Failed', 
        `ERROR: ${e.message}\n\n` +
        `Target: ${API_BASE_URL}\n\n` +
        `Possible Reasons:\n` +
        `1. Phone not on same Wi-Fi\n` +
        `2. Windows Firewall blocking port 8080\n` +
        `3. Laptop IP has changed`
      );
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

        <TouchableOpacity style={styles.footerLink} onPress={() => Alert.alert('Prama E2EE', 'v1.0.1 - Secure Messaging')}>
          <Text style={styles.footerText}>Don't have an account? Sign Up</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.debugButton}
          onPress={testConnection}
        >
          <Activity color="#66fcf1" size={16} />
          <Text style={styles.debugText}>Network Diagnostics</Text>
        </TouchableOpacity>
      </View>

      {/* Floating F12 Icon */}
      <TouchableOpacity 
        style={styles.floatingBug}
        onPress={() => setShowConsole(true)}
      >
        <Bug color="#0b0c10" size={24} />
      </TouchableOpacity>

      {/* DevOps Console Modal */}
      <Modal
        visible={showConsole}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowConsole(false)}
      >
        <View style={styles.consoleContainer}>
          <View style={styles.consoleHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Terminal color="#66fcf1" size={20} />
              <Text style={styles.consoleTitle}>DevOps Console (F12)</Text>
            </View>
            <TouchableOpacity onPress={() => setShowConsole(false)}>
              <X color="#fff" size={24} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.consoleBody}>
            {logs.length === 0 ? (
              <Text style={{ color: '#888', fontStyle: 'italic' }}>No logs yet. Try logging in or testing connection...</Text>
            ) : (
              logs.map((log, i) => (
                <Text key={i} style={styles.logLine}>{log}</Text>
              ))
            )}
          </ScrollView>
          <TouchableOpacity 
            style={styles.clearButton} 
            onPress={() => setLogs([])}
          >
            <Text style={{ color: '#fff', fontSize: 12 }}>Clear Logs</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
  debugButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
    gap: 8,
    opacity: 0.6,
  },
  debugText: {
    color: '#66fcf1',
    fontSize: 12,
  },
  floatingBug: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    backgroundColor: '#66fcf1',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#66fcf1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  consoleContainer: {
    flex: 1,
    backgroundColor: 'rgba(11, 12, 16, 0.95)',
    marginTop: 100,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  consoleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(102, 252, 241, 0.3)',
    paddingBottom: 10,
  },
  consoleTitle: {
    color: '#66fcf1',
    fontSize: 16,
    fontWeight: 'bold',
  },
  consoleBody: {
    flex: 1,
  },
  logLine: {
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    marginBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 2,
  },
  clearButton: {
    alignSelf: 'center',
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 5,
  },
});
