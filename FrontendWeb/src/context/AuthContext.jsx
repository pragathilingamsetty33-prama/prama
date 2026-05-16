import React, { createContext, useContext, useState, useEffect } from 'react';
import { generateRSAKeyPair, deriveKeyFromPassword, encryptDataWithPassword, decryptDataWithPassword } from '../utils/crypto';
import { requestForToken } from '../firebase';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const API_BASE = import.meta.env.VITE_API_URL;
    const [user, setUser] = useState(null);
    const [keys, setKeys] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // On page refresh: restore session if password is in sessionStorage
        const storedUser = localStorage.getItem('prama_auth_user');
        const sessionPwd = localStorage.getItem('session_pwd');

        if (storedUser && sessionPwd) {
            const parsedUser = JSON.parse(storedUser);
            const storedEncryptedKeys = localStorage.getItem(`rsaKeys_${parsedUser.userId}`);

            if (storedEncryptedKeys) {
                (async () => {
                    try {
                        const derivedKey = await deriveKeyFromPassword(sessionPwd, parsedUser.userId);
                        const decryptedStr = decryptDataWithPassword(JSON.parse(storedEncryptedKeys), derivedKey);
                        const parsedKeys = JSON.parse(decryptedStr);
                        setUser(parsedUser);
                        setKeys(parsedKeys);

                        // Re-sync public key with backend
                        fetch(`${API_BASE}/api/v1/users/sync-key`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + parsedUser.accessToken,
                            },
                            body: JSON.stringify({ publicKey: parsedKeys.publicKey })
                        }).catch(console.error);

                        requestForToken(parsedUser.accessToken);
                    } catch (e) {
                        console.error('Session restore failed, forcing re-login:', e);
                        localStorage.removeItem('prama_auth_user');
                        setUser(null);
                    } finally {
                        setLoading(false);
                    }
                })();
                return;
            }
        } else if (storedUser && !sessionPwd) {
            localStorage.removeItem('prama_auth_user');
        }
        setLoading(false);
    }, []);

    const login = async (identifier, password, onStatusUpdate) => {
        const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        });

        if (!res.ok) throw new Error('Login failed');
        const data = await res.json();

        let currentKeys = null;
        if (onStatusUpdate) onStatusUpdate('Securing session...');
        const derivedKey = await deriveKeyFromPassword(password, data.userId);

        // 1. Try local storage
        const storedEncryptedKeys = localStorage.getItem(`rsaKeys_${data.userId}`);
        if (storedEncryptedKeys) {
            try {
                if (onStatusUpdate) onStatusUpdate('Decrypting local keys...');
                const decryptedStr = decryptDataWithPassword(JSON.parse(storedEncryptedKeys), derivedKey);
                currentKeys = JSON.parse(decryptedStr);
            } catch (e) {
            }
        }

        // 2. Try server key bundle
        if (!currentKeys) {
            try {
                if (onStatusUpdate) onStatusUpdate('Syncing keys from server...');
                const bundleRes = await fetch(`${API_BASE}/api/v1/users/key-bundle`, {
                    headers: { 'Authorization': 'Bearer ' + data.accessToken }
                });
                if (bundleRes.ok) {
                    const bundleData = await bundleRes.json();
                    try {
                        if (onStatusUpdate) onStatusUpdate('Decrypting synced keys...');
                        const decryptedStr = decryptDataWithPassword(bundleData, derivedKey);
                        currentKeys = JSON.parse(decryptedStr);
                    } catch (decryptErr) {
                    }
                } else if (bundleRes.status === 404) {
                } else {
                }
            } catch (e) {
            }
        }

        // 3. Generate if still none
        if (!currentKeys) {
            if (onStatusUpdate) onStatusUpdate('Generating new keys...');
            currentKeys = await generateRSAKeyPair();

            await fetch(`${API_BASE}/api/v1/users/sync-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + data.accessToken,
                },
                body: JSON.stringify({ publicKey: currentKeys.publicKey })
            });
        }

        // 4. Store locally and upload to server
        if (onStatusUpdate) onStatusUpdate('Saving secure session...');
        const encryptedKeys = encryptDataWithPassword(JSON.stringify(currentKeys), derivedKey);
        localStorage.setItem(`rsaKeys_${data.userId}`, JSON.stringify(encryptedKeys));
        localStorage.setItem('session_pwd', password);

        try {
            await fetch(`${API_BASE}/api/v1/users/key-bundle`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + data.accessToken,
                },
                body: JSON.stringify({ encryptedKeyBundle: JSON.stringify(encryptedKeys) })
            });
        } catch (e) {
        }

        setKeys(currentKeys);
        setUser(data);
        localStorage.setItem('prama_auth_user', JSON.stringify(data));
        requestForToken(data.accessToken);
        return data;
    };

    const register = async (username, email, password) => {
        const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Registration failed');
        }

        return true;
    };

    const logout = () => {
        setUser(null);
        setKeys(null);
        localStorage.removeItem('prama_auth_user');
        localStorage.removeItem('session_pwd');
    };

    const apiFetch = async (url, options = {}) => {
        let currentUser = user;
        if (!currentUser) {
            const stored = localStorage.getItem('prama_auth_user');
            if (stored) currentUser = JSON.parse(stored);
        }

        // Security Gating: Prevent non-admins from hitting admin endpoints to avoid 403 loops
        if (url.includes('/api/v1/admin/') && currentUser?.role !== 'ROLE_ADMIN') {
            return {
                ok: false,
                status: 403,
                statusText: 'Forbidden (Role Gated)',
                json: async () => ({ error: 'Unauthorized: Admin role required' }),
                text: async () => 'Unauthorized'
            };
        }

        const runFetch = (token) => {
            const headers = { ...options.headers };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            return fetch(url, { ...options, headers });
        };

        let res = await runFetch(currentUser?.accessToken);

        if (res.status === 401 || res.status === 403) {
            if (currentUser?.refreshToken) {
                try {
                    const refreshRes = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: currentUser.refreshToken })
                    });

                    if (refreshRes.ok) {
                        const refreshData = await refreshRes.json();
                        const updatedUser = { ...currentUser, accessToken: refreshData.accessToken };
                        setUser(updatedUser);
                        localStorage.setItem('prama_auth_user', JSON.stringify(updatedUser));
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

    return (
        <AuthContext.Provider value={{ user, setUser, keys, login, register, logout, loading, apiFetch }}>
            {children}
        </AuthContext.Provider>
    );
};
