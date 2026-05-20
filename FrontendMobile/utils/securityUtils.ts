import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as matcherPwned from '@zxcvbn-ts/matcher-pwned';
import Argon2 from 'react-native-argon2';
import * as Crypto from 'expo-crypto';

/**
 * Security Utilities for Prama E2EE
 * Handles password strength, breach detection, and Argon2id key derivation.
 */

// Initialize zxcvbn with pwned matcher
const options = {
  translations: undefined,
  graphs: undefined,
  dictionary: undefined,
};
zxcvbnOptions.setOptions(options);

/**
 * Check password strength using zxcvbn.
 * Returns a score from 0 to 4.
 */
export const checkPasswordStrength = (password: string) => {
  const result = zxcvbn(password);
  return result.score;
};

/**
 * Check if password has been breached using HIBP k-Anonymity.
 */
export const checkBreachStatus = async (password: string): Promise<boolean> => {
  try {
    // SHA-1 hash of the password
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA1,
      password
    );
    const upperHash = hash.toUpperCase();
    const prefix = upperHash.substring(0, 5);
    const suffix = upperHash.substring(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!response.ok) return false;

    const text = await response.text();
    const lines = text.split('\n');
    
    // Check if the suffix exists in the returned list
    return lines.some(line => line.split(':')[0] === suffix);
  } catch (error) {
    console.error('HIBP check failed:', error);
    return false; // Fail safe
  }
};

/**
 * Derive MasterKey from password using Argon2id.
 * Parameters balanced for mobile: 64MB RAM, 3 iterations, 4 parallelism.
 */
export const deriveMasterKey = async (password: string, salt: string): Promise<string> => {
  const result = await Argon2(password, salt, {
    iterations: 3,
    memory: 65536, // 64MB
    parallelism: 4,
    hashLength: 32,
    mode: 'argon2id',
  });
  
  if (!result.rawHash) throw new Error('Argon2 derivation failed');
  return result.rawHash; // Hex encoded by default in react-native-argon2
};
