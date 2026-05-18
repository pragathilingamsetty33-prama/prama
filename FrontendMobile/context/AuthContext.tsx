import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { encryptDataWithPassword, decryptDataWithPassword, deriveKeyFromPassword, generateRSAKeyPair } from '../utils/crypto';
import { API_BASE_URL } from '../constants/Config';
import { Buffer } from 'buffer';
import { clearGlobalAttachmentCache } from '../utils/AttachmentCache';
import * as Notifications from 'expo-notifications';

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
  getOrRefreshToken: () => Promise<string | null>;
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

  const registerPushNotifications = async (authToken: string) => {
    if (Platform.OS === 'web') return;
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('⚠️ [Push] Notification permissions not granted.');
        return;
      }
      const pushToken = (await Notifications.getDevicePushTokenAsync()).data;
      if (pushToken && authToken) {
        console.log('🔔 [Push] Syncing dynamic FCM device push token...');
        const res = await fetch(`${API_BASE_URL}/api/v1/users/fcm-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}` // JWT session token
          },
          body: JSON.stringify({ fcmToken: pushToken }) // FCM token in body
        });
        if (res.ok) {
          console.log('🔔 [Push] FCM push token successfully registered.');
        } else {
          console.warn(`⚠️ [Push] FCM registration server returned error code: ${res.status}`);
        }
      }
    } catch (e: any) {
      console.warn('⚠️ [Push] Notification token synchronization failed:', e.message || e);
    }
  };

  useEffect(() => {
    const restoreSession = async () => {
      // Boot Purge Loop (Guaranteed Anti-Crash loop)
      (async () => {
        if (Platform.OS === 'web') return;
        try {
          const dir = FileSystem.documentDirectory;
          if (dir) {
            const files = await FileSystem.readDirectoryAsync(dir);
            const tempAttachmentPattern = /^https?_|^temp_file/;
            for (const fileName of files) {
              if (tempAttachmentPattern.test(fileName)) {
                const fileUri = dir + fileName;
                try {
                  await FileSystem.deleteAsync(fileUri, { idempotent: true });
                  console.log(`🧹 [BootPurge] Cleaned leftover file: ${fileName}`);
                } catch (fileErr) {
                  console.warn(`⚠️ [BootPurge] Could not delete locked file: ${fileName}`, fileErr);
                }
              }
            }
          }

          // Gotcha 3 platform-agnostic deferred share cache boot purge
          const shareTempDir = FileSystem.cacheDirectory + 'share_temp/';
          const shareDirInfo = await FileSystem.getInfoAsync(shareTempDir);
          if (shareDirInfo.exists) {
            await FileSystem.deleteAsync(shareTempDir, { idempotent: true });
            console.log("🧹 [BootPurge] Cleaned up deferred E2EE sharing caches.");
          }
        } catch (dirErr) {
          console.warn("⚠️ [BootPurge] Directory scan failed:", dirErr);
        }
      })();

      try {
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 4000));

        const sessionPromise = (async () => {
          const storedUser = await getSecureItemAsync('user');
          const sessionPwd = await getSecureItemAsync('session_pwd');

          if (storedUser && sessionPwd) {
            console.log('🔄 [AuthContext] Found stored session credentials, attempting session restore...');
            const parsedUser = JSON.parse(storedUser);
            const storedEncryptedKeys = await getSecureItemAsync(`rsaKeys_${parsedUser.userId}`);

            if (storedEncryptedKeys) {
              try {
                console.log(`🔄 [AuthContext] Restoring keys from local SecureStore for user: ${parsedUser.userId}`);
                const derivedKey = await deriveKeyFromPassword(sessionPwd, parsedUser.userId);
                const decryptedStr = decryptDataWithPassword(JSON.parse(storedEncryptedKeys), derivedKey);
                const parsedKeys = JSON.parse(decryptedStr);
                setUser(parsedUser);
                setKeys(parsedKeys);
                setMasterKey(derivedKey);
                console.log('🔑 [AuthContext] Successfully restored local keys pair.');

                // Sync with IdentityManager's SecureStore keys for immediate decryption
                if (parsedKeys) {
                  console.log('🔑 [AuthContext] Syncing session keys to IdentityManager SecureStore slots...');
                  const wrappedPrivateKey = encryptDataWithPassword(parsedKeys.privateKey, derivedKey);
                  // 100% MATCH NAMESPACE: Writing wrapped private key to SecureStore slot
                  await setSecureItemAsync('prama_wrapped_private_key', JSON.stringify(wrappedPrivateKey));
                  await setSecureItemAsync('prama_public_key', parsedKeys.publicKey);
                  
                  // Save masterKey for background notifications worker
                  const masterKeyBase64 = Buffer.from(derivedKey).toString('base64');
                  await setSecureItemAsync('prama_master_key', masterKeyBase64);
                  console.log('🔑 [AuthContext] IdentityManager SecureStore slot sync complete.');
                  registerPushNotifications(parsedUser.accessToken).catch(err => console.warn("FCM dynamic reg failed:", err));
                }
              } catch (e) {
                console.error('❌ [AuthContext] Session restore decryption failed:', e);
              }
            } else {
              console.warn('⚠️ [AuthContext] No encrypted keys found in SecureStore during session restore.');
            }
          }
        })();

        await Promise.race([sessionPromise, timeoutPromise]);
      } catch (e) {
        console.error('❌ [AuthContext] Failed to restore session:', e);
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const login = async (identifier: string, password: string, onStatusUpdate?: (msg: string) => void) => {
    console.log(`🔐 [AuthContext] Attempting login fetch request for identifier: ${identifier}...`);
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error(`❌ [AuthContext] Login request failed with status: ${res.status}, body: ${errText}`);
        throw new Error(errText || 'Login failed');
    }
    const data = await res.json();
    console.log(`🔐 [AuthContext] Authentication successful. User ID: ${data.userId}. Deriving masterKey...`);

    if (onStatusUpdate) onStatusUpdate('Securing session...');
    const derivedKey = await deriveKeyFromPassword(password, data.userId);
    console.log('🔐 [AuthContext] MasterKey derived successfully.');

    let currentKeys: Keys | null = null;

    // Step 1: try local secure store
    console.log(`🔑 [AuthContext] Step 1: Querying local secure store for rsaKeys_${data.userId}...`);
    const storedEncryptedKeys = await getSecureItemAsync(`rsaKeys_${data.userId}`);
    if (storedEncryptedKeys) {
      try {
        if (onStatusUpdate) onStatusUpdate('Restoring local keys...');
        console.log('🔑 [AuthContext] Found encrypted keys in local secure store. Decrypting...');
        const decryptedStr = decryptDataWithPassword(JSON.parse(storedEncryptedKeys), derivedKey);
        currentKeys = JSON.parse(decryptedStr);
        console.log('🔑 [AuthContext] Successfully decrypted and loaded local keys.');
      } catch (e) {
        console.error('❌ [AuthContext] Could not decrypt stored keys:', e);
      }
    } else {
      console.log('🔑 [AuthContext] No local keys found in secure store.');
    }

    // Step 2: try server key-bundle (cross-device sync)
    if (!currentKeys) {
      try {
        if (onStatusUpdate) onStatusUpdate('Syncing keys from cloud...');
        const bundleUrl = `${API_BASE_URL}/api/v1/users/key-bundle`;
        console.log(`🔑 [AuthContext] Step 2: Fetching server key bundle from ${bundleUrl}...`);
        const bundleRes = await fetch(bundleUrl, {
          headers: { 'Authorization': 'Bearer ' + data.accessToken },
        });
        if (bundleRes.ok) {
          console.log('🔑 [AuthContext] Successfully retrieved wrapped key from backend. Decrypting...');
          const bundleData = await bundleRes.json();
          const decryptedStr = decryptDataWithPassword(bundleData, derivedKey);
          currentKeys = JSON.parse(decryptedStr);
          console.log('🔑 [AuthContext] Successfully decrypted server key bundle.');
        } else {
          console.warn(`⚠️ [AuthContext] Server key bundle response returned status: ${bundleRes.status}`);
        }
      } catch (e) {
        console.warn('⚠️ [AuthContext] Server key bundle query failed or keys missing:', e);
      }
    }

    // Step 3: generate fresh keys if none exist
    if (!currentKeys) {
      if (onStatusUpdate) onStatusUpdate('Generating fresh encryption keys...');
      console.log('🔑 [AuthContext] Step 3: No keys found locally or on server. Generating new RSA 2048-bit key pair...');
      const generated = await generateRSAKeyPair();
      currentKeys = generated;
      console.log('🔑 [AuthContext] RSA key pair generated. Syncing public key to backend...');
      const syncRes = await fetch(`${API_BASE_URL}/api/v1/users/sync-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + data.accessToken,
        },
        body: JSON.stringify({ publicKey: currentKeys.publicKey }),
      });
      console.log(`🔑 [AuthContext] Public key sync returned status: ${syncRes.status}`);
    }

    // Step 4: Encrypt and store locally + upload
    console.log('🔑 [AuthContext] Step 4: Encrypting key pair with MasterKey for local and remote backup...');
    const encryptedKeys = encryptDataWithPassword(JSON.stringify(currentKeys), derivedKey);

    if (onStatusUpdate) onStatusUpdate('Saving secure session...');

    console.log('🔑 [AuthContext] Saving session credentials and keys to local SecureStore...');
    // Store encrypted bundle locally and upload for cross-device sync
    await setSecureItemAsync(`rsaKeys_${data.userId}`, JSON.stringify(encryptedKeys));
    await setSecureItemAsync('user', JSON.stringify(data));
    await setSecureItemAsync('session_pwd', password);
    console.log('🔑 [AuthContext] Session credentials saved locally.');

    // Sync with IdentityManager's SecureStore keys for immediate decryption
    if (currentKeys) {
      try {
        console.log('🔑 [AuthContext] Syncing keys to IdentityManager SecureStore slots...');
        const wrappedPrivateKey = encryptDataWithPassword(currentKeys.privateKey, derivedKey);
        await setSecureItemAsync('prama_wrapped_private_key', JSON.stringify(wrappedPrivateKey));
        await setSecureItemAsync('prama_public_key', currentKeys.publicKey);
        
        // Save masterKey for background notifications worker
        const masterKeyBase64 = Buffer.from(derivedKey).toString('base64');
        await setSecureItemAsync('prama_master_key', masterKeyBase64);
        console.log('🔑 [AuthContext] IdentityManager SecureStore slots synced.');
      } catch (e) {
        console.error('❌ [AuthContext] Failed to save keys to IdentityManager SecureStore slots:', e);
      }
    }

    // Upload encrypted bundle to server
    try {
      console.log('🔑 [AuthContext] Uploading encrypted key bundle to server vault...');
      const uploadRes = await fetch(`${API_BASE_URL}/api/v1/users/key-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + data.accessToken,
        },
        body: JSON.stringify({ encryptedKeyBundle: typeof encryptedKeys === 'string' ? encryptedKeys : JSON.stringify(encryptedKeys) }),
      });
      console.log(`🔑 [AuthContext] Key bundle upload returned status: ${uploadRes.status}`);
    } catch (e) {
      console.error('❌ [AuthContext] Failed to upload key bundle to server:', e);
    }

    setKeys(currentKeys);
    setMasterKey(derivedKey);
    setUser(data);
    registerPushNotifications(data.accessToken).catch(err => console.warn("FCM dynamic login reg failed:", err));
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
    await deleteSecureItemAsync('prama_wrapped_private_key');
    await deleteSecureItemAsync('prama_public_key');
    await deleteSecureItemAsync('prama_master_key');

    // 🧹 [Proposal B & Gotchas Fixes] Forensic Logout Cache Shredder
    try {
      const dir = FileSystem.documentDirectory;
      if (dir) {
        const files = await FileSystem.readDirectoryAsync(dir);
        const tempAttachmentPattern = /^https?_|^temp_file/;
        for (const fileName of files) {
          if (tempAttachmentPattern.test(fileName)) {
            await FileSystem.deleteAsync(dir + fileName, { idempotent: true });
          }
        }
      }

      // Gotcha 3 Platform-Agnostic deferred share temp cleanup
      const shareTempDir = FileSystem.cacheDirectory + 'share_temp/';
      const shareDirInfo = await FileSystem.getInfoAsync(shareTempDir);
      if (shareDirInfo.exists) {
        await FileSystem.deleteAsync(shareTempDir, { idempotent: true });
      }

      // Gotcha 1: Purge dynamic JavaScript active memory heap references
      clearGlobalAttachmentCache();
      console.log("🧹 [Logout] Cleaned up secure session files and RAM caches successfully.");
    } catch (e) {
      console.warn("⚠️ [Logout] Exception captured during session unlinking:", e);
    }
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

  const getOrRefreshToken = async (): Promise<string | null> => {
    let currentUser = user;
    if (!currentUser) {
      const stored = await getSecureItemAsync('user');
      if (stored) currentUser = JSON.parse(stored);
    }
    if (!currentUser) return null;

    try {
      const token = currentUser.accessToken;
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('binary'));
        const exp = payload.exp * 1000; // convert to ms
        const now = Date.now();
        // If expired or expiring within 30 seconds, perform a proactive silent refresh
        if (exp - now < 30 * 1000) {
          console.log("🔄 [AuthContext] Token is expired or close to expiration. Proactively refreshing...");
          if (currentUser.refreshToken) {
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
              console.log("🔄 [AuthContext] Token successfully refreshed proactively.");
              return refreshData.accessToken;
            } else {
              console.warn("⚠️ [AuthContext] Silent token refresh failed. User might need to re-login.");
              logout();
            }
          }
        } else {
          return token;
        }
      }
    } catch (e) {
      console.error("❌ [AuthContext] Error parsing or refreshing token proactively:", e);
    }
    return currentUser.accessToken;
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
        body: JSON.stringify({ encryptedKeyBundle: typeof encryptedKeys === 'string' ? encryptedKeys : JSON.stringify(encryptedKeys) }),
      });
    } catch (e) {
      console.error('Manual key sync failed', e);
      throw e;
    }
  };

  return (
    <AuthContext.Provider value={{ user, keys, masterKey, login, register, logout, loading, apiFetch, syncKeysToServer, getOrRefreshToken }}>
      {children}
    </AuthContext.Provider>
  );
};
