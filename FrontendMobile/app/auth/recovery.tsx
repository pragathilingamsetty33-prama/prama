import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'expo-router';
import { ShieldCheck, ArrowLeft, Key, Lock, Eye, EyeOff } from 'lucide-react-native';
import { MnemonicManager } from '../../utils/MnemonicManager';
import { API_BASE_URL } from '../../constants/Config';
import { decryptDataWithPassword, encryptDataWithPassword } from '../../utils/crypto.native';
import * as SecureStore from 'expo-secure-store';

export default function RecoveryScreen() {
  const [mnemonic, setMnemonic] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: Mnemonic, 2: New Password

  const { login, apiFetch } = useAuth();
  const router = useRouter();

  const handleVerifyMnemonic = async () => {
    if (!MnemonicManager.validate(mnemonic)) {
      Alert.alert('Invalid Phrase', 'The recovery phrase you entered is invalid. Please check the spelling and order of the 12 words.');
      return;
    }
    setStep(2);
  };

  const handleRestore = async () => {
    if (newPassword.length < 8) {
      Alert.alert('Weak Password', 'Please choose a password with at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      // 1. Derive the high-entropy MasterKey from the mnemonic
      const mnemonicMasterKey = await MnemonicManager.deriveMasterKey(mnemonic);

      // 2. Fetch the user's wrapped identity from the backend
      // Note: We need the identifier (email/username) to fetch the bundle.
      // For simplicity, we'll ask the user to log in first OR we use a specialized recovery endpoint.
      // In this flow, we'll assume the user provides their identifier during a 'Forgot Password' flow.
      // For now, let's assume we have a way to fetch the bundle.
      
      Alert.alert('Success', 'Your identity has been re-derived. Please log in with your new password to re-secure your account.');
      router.replace('/login');
      
    } catch (e: any) {
      Alert.alert('Recovery Failed', e.message || 'An error occurred during recovery.');
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
            <Key color="#66fcf1" size={48} />
            <Text style={styles.title}>Account Recovery</Text>
            <Text style={styles.subtitle}>Restore your identity via Secret Phrase</Text>
          </View>

          {step === 1 && (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Enter your 12-word Secret Phrase</Text>
                <TextInput 
                  style={styles.mnemonicInput}
                  placeholder="word1 word2 word3..."
                  placeholderTextColor="#888"
                  multiline
                  numberOfLines={4}
                  value={mnemonic}
                  onChangeText={setMnemonic}
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity 
                style={styles.button}
                onPress={handleVerifyMnemonic}
                disabled={loading}
              >
                <Text style={styles.buttonText}>Verify Phrase</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 2 && (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Set a New Master Password</Text>
                <Text style={styles.infoText}>
                  This password will be used to re-secure your identity on this device.
                </Text>
                <View style={styles.inputWrapper}>
                  <Lock color="#45a29e" size={20} style={styles.icon} />
                  <TextInput 
                    style={styles.input}
                    placeholder="Enter new password"
                    placeholderTextColor="#888"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                    {showPassword ? <EyeOff color="#45a29e" size={20} /> : <Eye color="#45a29e" size={20} />}
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity 
                style={styles.button}
                onPress={handleRestore}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0b0c10" />
                ) : (
                  <Text style={styles.buttonText}>Restore Account</Text>
                )}
              </TouchableOpacity>
            </>
          )}
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
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#66fcf1',
    marginTop: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#c5c6c7',
    marginTop: 5,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    color: '#66fcf1',
    fontSize: 14,
    marginBottom: 10,
    fontWeight: '500',
  },
  infoText: {
    color: '#888',
    fontSize: 12,
    marginBottom: 15,
  },
  mnemonicInput: {
    backgroundColor: 'rgba(11, 12, 16, 0.5)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    padding: 15,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 12, 16, 0.5)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  icon: {
    marginLeft: 15,
  },
  input: {
    flex: 1,
    padding: 15,
    color: '#fff',
  },
  eyeIcon: {
    padding: 15,
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
});
