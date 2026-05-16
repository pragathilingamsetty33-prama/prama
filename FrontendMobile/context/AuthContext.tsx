import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { encryptDataWithPassword, decryptDataWithPassword, deriveKeyFromPassword, generateRSAKeyPair } from '../utils/crypto';
import { API_BASE_URL } from '../constants/Config';

interface User {
  userId: string;
  username: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

interface Keys {
  publicKey: string;
  privateKey: string;
}

interface AuthContextType {
  user: User | null;
  keys: Keys | null;
  masterKey: Uint8Array | null;
  loading: boolean;
  login: (identifier: string, password: string, onStatusUpdate?: (msg: string) => void) => Promise<User>;
  register: (username: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  syncKeysToServer: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// Web-safe wrappers for SecureStore
const getSecureItemAsync = async (key: string) => {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
};

const setSecureItemAsync = async (key: string, value: string) => {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
};

const deleteSecureItemAsync = async (key: string) => {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<Keys | null>(null);
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 4000));

        const sessionPromise = (async () => {
          const storedUser = await getSecureItemAsync('user');
          const sessionPwd = await getSecureItemAsync('session_pwd');

          if (storedUser && sessionPwd) {
            const parsedUser = JSON.parse(storedUser);
            const storedEncryptedKeys = await getSecureItemAsync(`rsaKeys_${parsedUser.userId}`);

            if (storedEncryptedKeys) {
              try {
                const derivedKey = await deriveKeyFromPassword(sessionPwd, parsedUser.userId);
                const decryptedStr = decryptDataWithPassword(JSON.parse(storedEncryptedKeys), derivedKey);
                const parsedKeys = JSON.parse(decryptedStr);
                setUser(parsedUser);
                setKeys(parsedKeys);
                setMasterKey(derivedKey);
              } catch (e) {
                console.error('Session restore decryption failed', e);
              }
            }
          }
        })();

        await Promise.race([sessionPromise, timeoutPromise]);
      } catch (e) {
        console.error('Failed to restore session', e);
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const login = async (identifier: string, password: string, onStatusUpdate?: (msg: string) => void) => {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Login failed');
    }
    const data = await res.json();

    if (onStatusUpdate) onStatusUpdate('Securing session...');
    const derivedKey = await deriveKeyFromPassword(password, data.userId);

    let currentKeys: Keys | null = null;

    // Step 1: try local secure store
    const storedEncryptedKeys = await getSecureItemAsync(`rsaKeys_${data.userId}`);
    if (storedEncryptedKeys) {
      try {
        if (onStatusUpdate) onStatusUpdate('Restoring local keys...');
        const decryptedStr = decryptDataWithPassword(JSON.parse(storedEncryptedKeys), derivedKey);
        currentKeys = JSON.parse(decryptedStr);
      } catch (e) {
        console.error('Could not decrypt stored keys', e);
      }
    }

    // Step 2: try server key-bundle (cross-device sync)
    if (!currentKeys) {
      try {
        if (onStatusUpdate) onStatusUpdate('Syncing keys from cloud...');
        const bundleRes = await fetch(`${API_BASE_URL}/api/v1/users/key-bundle`, {
          headers: { 'Authorization': 'Bearer ' + data.accessToken },
        });
        if (bundleRes.ok) {
          const bundleData = await bundleRes.json();
          const decryptedStr = decryptDataWithPassword(bundleData, derivedKey);
          currentKeys = JSON.parse(decryptedStr);
        }
      } catch (e) {
        console.log('No server key bundle, will generate new keys');
      }
    }

    // Step 3: generate fresh keys if none exist
    if (!currentKeys) {
      if (onStatusUpdate) onStatusUpdate('Generating fresh encryption keys...');
      const generated = await generateRSAKeyPair();
      currentKeys = generated;
      await fetch(`${API_BASE_URL}/api/v1/users/sync-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + data.accessToken,
        },
        body: JSON.stringify({ publicKey: currentKeys.publicKey }),
      });
    }

    // Step 4: Encrypt and store locally + upload
    const encryptedKeys = encryptDataWithPassword(JSON.stringify(currentKeys), derivedKey);

    if (onStatusUpdate) onStatusUpdate('Saving secure session...');

    // Store encrypted bundle locally and upload for cross-device sync
    await setSecureItemAsync(`rsaKeys_${data.userId}`, JSON.stringify(encryptedKeys));
    await setSecureItemAsync('user', JSON.stringify(data));
    await setSecureItemAsync('session_pwd', password);

    // Upload encrypted bundle to server
    try {
      await fetch(`${API_BASE_URL}/api/v1/users/key-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + data.accessToken,
        },
        body: JSON.stringify({ encryptedKeyBundle: JSON.stringify(encryptedKeys) }),
      });
    } catch (e) {
      console.error('Failed to upload key bundle', e);
    }

    setKeys(currentKeys);
    setMasterKey(derivedKey);
    setUser(data);
    return data;
  };

  const register = async (username: string, email: string, password: string) => {
    const newKeys = await generateRSAKeyPair();

    const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, publicKey: newKeys.publicKey }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || 'Registration failed');
    }

    return true;
  };

  const logout = async () => {
    setUser(null);
    setKeys(null);
    setMasterKey(null);
    if (user) {
      await deleteSecureItemAsync(`rsaKeys_${user.userId}`);
    }
    await deleteSecureItemAsync('user');
    await deleteSecureItemAsync('session_pwd');
  };

  const apiFetch = async (url: string, options: any = {}) => {
    let currentUser = user;
    if (!currentUser) {
      const stored = await getSecureItemAsync('user');
      if (stored) currentUser = JSON.parse(stored);
    }

    const runFetch = (token?: string) => {
      const headers = { ...options.headers };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      // Auto-prepend base URL for relative paths
      const finalUrl = url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
      return fetch(finalUrl, { ...options, headers });
    };

    let res = await runFetch(currentUser?.accessToken);

    if (res.status === 401 || res.status === 403) {
      if (currentUser?.refreshToken) {
        try {
          const refreshRes = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: currentUser.refreshToken }),
          });

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            const updatedUser = { ...currentUser, accessToken: refreshData.accessToken };
            setUser(updatedUser);
            await setSecureItemAsync('user', JSON.stringify(updatedUser));
            res = await runFetch(updatedUser.accessToken);
          } else {
            logout();
          }
        } catch (e) {
          logout();
        }
      } else {
        logout();
      }
    }
    return res;
  };

  const syncKeysToServer = async () => {
    if (!user || !keys) {
      return;
    }
    const sessionPwd = await getSecureItemAsync('session_pwd');
    if (!sessionPwd) {
      return;
    }

    try {
      const derivedKey = await deriveKeyFromPassword(sessionPwd, user.userId);
      const encryptedKeys = encryptDataWithPassword(JSON.stringify(keys), derivedKey);

      await fetch(`${API_BASE_URL}/api/v1/users/key-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + user.accessToken,
        },
        body: JSON.stringify({ encryptedKeyBundle: JSON.stringify(encryptedKeys) }),
      });
    } catch (e) {
      console.error('Manual key sync failed', e);
      throw e;
    }
  };

  return (
    <AuthContext.Provider value={{ user, keys, masterKey, login, register, logout, loading, apiFetch, syncKeysToServer }}>
      {children}
    </AuthContext.Provider>
  );
};
