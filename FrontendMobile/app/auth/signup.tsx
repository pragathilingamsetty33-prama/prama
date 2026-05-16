import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'expo-router';
import { ShieldCheck, ArrowLeft, Lock, Mail, User, Eye, EyeOff } from 'lucide-react-native';
import { checkPasswordStrength, checkBreachStatus } from '../../utils/securityUtils';
import { MnemonicManager } from '../../utils/MnemonicManager';

export default function SignupScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [strength, setStrength] = useState(0);
  const [step, setStep] = useState(1); // 1: Info, 2: Mnemonic
  const [mnemonic, setMnemonic] = useState('');
  const [backedUp, setBackedUp] = useState(false);

  const { register } = useAuth();
  const router = useRouter();

  const onPasswordChange = (text: string) => {
    setPassword(text);
    setStrength(checkPasswordStrength(text));
  };

  const handleSignup = async () => {
    if (!username || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (strength < 3) {
      Alert.alert('Weak Password', 'Your password is too weak. Please use a stronger combination of letters, numbers, and symbols.');
      return;
    }

    setLoading(true);
    try {
      const isBreached = await checkBreachStatus(password);
      if (isBreached) {
        Alert.alert('Security Warning', 'This password has appeared in a known data breach. For your safety, please choose a different password.');
        setLoading(false);
        return;
      }

      // Generate Mnemonic for this account
      const generatedMnemonic = MnemonicManager.generateMnemonic();
      setMnemonic(generatedMnemonic);
      setStep(2); // Move to Mnemonic backup step

    } catch (e: any) {
      Alert.alert('Signup Failed', e.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const completeRegistration = async () => {
    if (!backedUp) {
      Alert.alert('Backup Required', 'Please confirm that you have backed up your secret phrase.');
      return;
    }

    setLoading(true);
    try {
      await register(username, email, password);
      Alert.alert('Success', 'Account created! Please store your secret phrase safely.');
      router.replace('/login');
    } catch (e: any) {
      Alert.alert('Signup Failed', e.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getStrengthColor = () => {
    if (strength <= 1) return '#ff4d4d';
    if (strength === 2) return '#ffa64d';
    if (strength === 3) return '#66ccff';
    return '#66fcf1';
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.glassPanel}>
          <View style={styles.header}>
            <ShieldCheck color="#66fcf1" size={48} />
            <Text style={styles.title}>Join Prama</Text>
            <Text style={styles.subtitle}>End-to-End Encrypted Privacy</Text>
          </View>

          {step === 1 && (
            <>
              <View style={styles.inputContainer}>
                <View style={styles.field}>
                  <Text style={styles.label}>Username</Text>
                  <View style={styles.inputWrapper}>
                    <User color="#45a29e" size={20} style={styles.icon} />
                    <TextInput 
                      style={styles.input}
                      placeholder="Choose a username"
                      placeholderTextColor="#888"
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Email Address</Text>
                  <View style={styles.inputWrapper}>
                    <Mail color="#45a29e" size={20} style={styles.icon} />
                    <TextInput 
                      style={styles.input}
                      placeholder="Enter your email"
                      placeholderTextColor="#888"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Master Password</Text>
                  <View style={styles.inputWrapper}>
                    <Lock color="#45a29e" size={20} style={styles.icon} />
                    <TextInput 
                      style={styles.input}
                      placeholder="Enter a strong password"
                      placeholderTextColor="#888"
                      value={password}
                      onChangeText={onPasswordChange}
                      secureTextEntry={!showPassword}
                    />
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                      {showPassword ? <EyeOff color="#45a29e" size={20} /> : <Eye color="#45a29e" size={20} />}
                    </TouchableOpacity>
                  </View>
                  
                  {password.length > 0 && (
                    <View style={styles.strengthBarContainer}>
                      <View style={[styles.strengthBar, { width: `${(strength + 1) * 20}%`, backgroundColor: getStrengthColor() }]} />
                      <Text style={[styles.strengthText, { color: getStrengthColor() }]}>
                        {['Too Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'][strength]}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              <TouchableOpacity 
                style={styles.button}
                onPress={handleSignup}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0b0c10" />
                ) : (
                  <Text style={styles.buttonText}>Continue to Backup</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {step === 2 && (
            <View style={styles.mnemonicContainer}>
              <Text style={styles.mnemonicTitle}>Secret Recovery Phrase</Text>
              <Text style={styles.mnemonicSubtitle}>
                Write down these 12 words in order. This phrase is the ONLY way to recover your account if you forget your password.
              </Text>
              
              <View style={styles.mnemonicGrid}>
                {mnemonic.split(' ').map((word, idx) => (
                  <View key={idx} style={styles.mnemonicWord}>
                    <Text style={styles.mnemonicIndex}>{idx + 1}</Text>
                    <Text style={styles.mnemonicText}>{word}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.warningBox}>
                <Text style={styles.warningText}>
                  ⚠️ Never share this phrase with anyone. Prama employees will never ask for it.
                </Text>
              </View>

              <TouchableOpacity 
                style={[styles.checkboxContainer, backedUp && styles.checkboxActive]}
                onPress={() => setBackedUp(!backedUp)}
              >
                <Text style={styles.checkboxLabel}>
                  I have written down my recovery phrase and stored it safely.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.button, !backedUp && styles.buttonDisabled]}
                onPress={completeRegistration}
                disabled={!backedUp || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0b0c10" />
                ) : (
                  <Text style={styles.buttonText}>Finish Registration</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

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
  header: {
    alignItems: 'center',
    marginBottom: 30,
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
    marginBottom: 20,
  },
  field: {
    marginBottom: 15,
  },
  label: {
    color: '#66fcf1',
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 4,
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
  strengthBarContainer: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  strengthBar: {
    height: 4,
    borderRadius: 2,
    flex: 1,
    marginRight: 10,
  },
  strengthText: {
    fontSize: 10,
    fontWeight: 'bold',
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
  footerLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  footerText: {
    color: '#888',
    fontSize: 14,
  },
  mnemonicContainer: {
    marginTop: 10,
  },
  mnemonicTitle: {
    color: '#66fcf1',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  mnemonicSubtitle: {
    color: '#c5c6c7',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  mnemonicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(11, 12, 16, 0.5)',
    borderRadius: 15,
    padding: 15,
    marginBottom: 20,
  },
  mnemonicWord: {
    width: '48%',
    flexDirection: 'row',
    backgroundColor: 'rgba(31, 40, 51, 0.8)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.1)',
  },
  mnemonicIndex: {
    color: '#45a29e',
    fontSize: 12,
    marginRight: 8,
    width: 15,
  },
  mnemonicText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  warningBox: {
    backgroundColor: 'rgba(255, 77, 77, 0.1)',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.3)',
  },
  warningText: {
    color: '#ff4d4d',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  checkboxContainer: {
    backgroundColor: 'rgba(11, 12, 16, 0.5)',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  checkboxActive: {
    borderColor: '#66fcf1',
    backgroundColor: 'rgba(102, 252, 241, 0.05)',
  },
  checkboxLabel: {
    color: '#c5c6c7',
    fontSize: 13,
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
