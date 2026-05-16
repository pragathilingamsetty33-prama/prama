/**
 * KeyCache Utility
 * Caches decrypted AES keys in localStorage to prevent redundant RSA-unwrap operations.
 * ZERO-KNOWLEDGE: Only the symmetric AES key is cached, NOT the message content.
 */

const CACHE_PREFIX = 'prama_key_cache_';

export const KeyCache = {
    /**
     * Store a decrypted AES key for a specific message.
     * @param {string} messageId 
     * @param {string} decryptedAESKey (raw string/binary)
     */
    saveKey: (messageId, decryptedAESKey) => {
        if (!messageId || !decryptedAESKey) return;
        try {
            // Using btoa if it's a binary string to ensure safe storage
            const encodedKey = typeof decryptedAESKey === 'string' ? btoa(decryptedAESKey) : decryptedAESKey;
            localStorage.setItem(`${CACHE_PREFIX}${messageId}`, encodedKey);
        } catch (e) {
            console.error('Failed to cache key:', e);
        }
    },

    /**
     * Retrieve a cached AES key for a specific message.
     * @param {string} messageId 
     * @returns {string|null} The decrypted AES key
     */
    getKey: (messageId) => {
        if (!messageId) return null;
        const cached = localStorage.getItem(`${CACHE_PREFIX}${messageId}`);
        if (!cached) return null;
        try {
            return atob(cached);
        } catch (e) {
            return cached; // Fallback if not b64 encoded
        }
    },

    /**
     * Clear the cache (e.g. on logout)
     */
    clear: () => {
        Object.keys(localStorage)
            .filter(key => key.startsWith(CACHE_PREFIX))
            .forEach(key => localStorage.removeItem(key));
    }
};
