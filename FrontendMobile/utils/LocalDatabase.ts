import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import forge from 'node-forge';
import { initGroupSessionDB } from './GroupSessionStore';
import { encryptMessageWithAES, decryptMessageWithAES } from './crypto';
import { Buffer } from 'buffer';

const KEY_DB_ENVELOPE = 'prama_db_envelope_key';
const KEY_METADATA_MASK = 'prama_db_metadata_mask_key';
const KEY_SEARCH_HMAC = 'prama_db_search_hmac_key';

// In-memory key caching to protect physical enclave access during high-volume queries
let keysCached = false;
let dbEnvelopeKey = '';
let dbMetadataKey = '';
let dbSearchKey = '';

const getSecureKey = async (keyName: string): Promise<string> => {
  const cached = await SecureStore.getItemAsync(keyName);
  if (cached) return cached;

  // Generate secure random key (256-bit) in Base64
  const randomBytes = forge.random.getBytesSync(32);
  const val = forge.util.encode64(randomBytes);
  await SecureStore.setItemAsync(keyName, val, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED
  });
  return val;
};

export const initSecureKeys = async (): Promise<void> => {
  if (keysCached) return;
  dbEnvelopeKey = await getSecureKey(KEY_DB_ENVELOPE);
  dbMetadataKey = await getSecureKey(KEY_METADATA_MASK);
  dbSearchKey = await getSecureKey(KEY_SEARCH_HMAC);
  keysCached = true;
};

export const hmacSHA256 = (message: string, keyBase64: string): string => {
  const hmac = forge.hmac.create();
  hmac.start('sha256', forge.util.decode64(keyBase64));
  hmac.update(message);
  return forge.util.encode64(hmac.digest().getBytes());
};

// Mask metadata using deterministic keyed HMAC-SHA256
export const maskId = (rawId: string): string => {
  if (!keysCached) throw new Error("Database keys are not initialized.");
  return hmacSHA256(rawId, dbMetadataKey);
};

// Deterministic Server Message Hash
export const computeServerMessageHash = (serverUuid: string): string => {
  if (!keysCached) throw new Error("Database keys are not initialized.");
  const fullHash = hmacSHA256(serverUuid, dbMetadataKey);
  // Truncate to save disk space while avoiding collision issues in standard messaging sizes
  return Buffer.from(fullHash, 'base64').slice(0, 16).toString('base64');
};

// Word Tokenizer & Blind Index Generation
export const generateBlindIndexes = (text: string): string[] => {
  if (!keysCached) throw new Error("Database keys are not initialized.");
  if (!text) return [];
  
  // Lowercase, strip punctuation, split by word boundaries
  const words = Array.from(new Set(text.toLowerCase().match(/\b\w+\b/g) || []));
  
  return words.map(word => {
    const wordHmac = hmacSHA256(word, dbSearchKey);
    // Truncate to 16 bytes for storage efficiency
    return Buffer.from(wordHmac, 'base64').slice(0, 16).toString('base64');
  });
};

export interface LocalMessageRecord {
  id?: number;
  serverMessageHash?: string | null; // Masked server UUID
  chatId: string;                     // Raw chat UUID (hashed on write)
  senderId: string;                   // Raw sender UUID (hashed on write)
  timestamp: number;
  text: string;
  attachment: any | null;
  isRead?: number;
  replyToId?: string | null;
  replyToSender?: string | null;
  replyToText?: string | null;
}

// 1. Initialize Tables in the Shared Database File
export const initLocalMessagesTable = async (): Promise<SQLite.SQLiteDatabase> => {
  const db = await initGroupSessionDB(); // Re-use connection to shared database file
  await initSecureKeys();

  // Create local_messages (De-correlated Auto-Increment Primary Key)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_message_hash TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      encrypted_payload TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      is_read INTEGER DEFAULT 0
    );
  `);

  // Create message_blind_indexes (Many-to-Many lookup)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS message_blind_indexes (
      local_message_id INTEGER NOT NULL,
      word_hash TEXT NOT NULL,
      PRIMARY KEY (local_message_id, word_hash),
      FOREIGN KEY (local_message_id) REFERENCES local_messages(id) ON DELETE CASCADE
    );
  `);

  // Create high-performance indexes
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_messages_chat ON local_messages(chat_id);');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_messages_server_hash ON local_messages(server_message_hash);');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_blind_word ON message_blind_indexes(word_hash);');

  return db;
};

// 2. Write Message & Indexes inside a Strict Atomic Transaction
export const saveLocalMessage = async (msg: LocalMessageRecord): Promise<void> => {
  const db = await initLocalMessagesTable();

  // Obfuscate metadata
  const maskedChatId = maskId(msg.chatId);
  const maskedSenderId = maskId(msg.senderId);
  const serverHash = msg.serverMessageHash ? computeServerMessageHash(msg.serverMessageHash) : null;

  // De-duplication check: if serverHash is present and already exists, ignore to protect idempotent synchronization
  if (serverHash) {
    const existing = await db.getFirstAsync('SELECT 1 FROM local_messages WHERE server_message_hash = ?', [serverHash]);
    if (existing) return;
  }

  // Application-Layer GCM Envelope Encryption of payload
  const payloadToEncrypt = JSON.stringify({
    text: msg.text,
    attachment: msg.attachment,
    replyToId: msg.replyToId,
    replyToSender: msg.replyToSender,
    replyToText: msg.replyToText
  });

  const encryptedData = encryptMessageWithAES(payloadToEncrypt, dbEnvelopeKey);

  // Generate Blind Index hashes
  const blindIndexHashes = generateBlindIndexes(msg.text);

  // STRICT ACID WRITER: Indivisible Database Transaction Block
  await db.withTransactionAsync(async () => {
    // 1. Insert message
    const result = await db.runAsync(
      `INSERT INTO local_messages (server_message_hash, chat_id, sender_id, timestamp, encrypted_payload, iv, tag, is_read) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        serverHash,
        maskedChatId,
        maskedSenderId,
        msg.timestamp,
        encryptedData.ciphertext,
        encryptedData.iv,
        encryptedData.tag,
        msg.isRead || 0
      ]
    );

    const localMessageId = result.lastInsertRowId;

    // 2. Insert corresponding blind indexes
    for (const hash of blindIndexHashes) {
      await db.runAsync(
        'INSERT OR IGNORE INTO message_blind_indexes (local_message_id, word_hash) VALUES (?, ?)',
        [localMessageId, hash]
      );
    }
  });
};

// 3. Query Encrypted Messages Chronologically by Chat ID
export const getLocalMessages = async (chatId: string, limit = 50, lastTimestamp?: number): Promise<LocalMessageRecord[]> => {
  const db = await initLocalMessagesTable();
  const maskedChatId = maskId(chatId);

  let query = 'SELECT * FROM local_messages WHERE chat_id = ?';
  const params: any[] = [maskedChatId];

  if (lastTimestamp) {
    query += ' AND timestamp < ?';
    params.push(lastTimestamp);
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = await db.getAllAsync<any>(query, params);

  const decryptedRecords: LocalMessageRecord[] = [];

  for (const row of rows) {
    try {
      const decryptedStr = decryptMessageWithAES({
        ciphertext: row.encrypted_payload,
        iv: row.iv,
        tag: row.tag
      }, dbEnvelopeKey);

      const parsed = JSON.parse(decryptedStr);

      decryptedRecords.push({
        id: row.id,
        chatId: chatId, // Map back to raw query context
        senderId: row.sender_id, // Masked representation remains intact
        timestamp: row.timestamp,
        text: parsed.text || '',
        attachment: parsed.attachment || null,
        isRead: row.is_read,
        replyToId: parsed.replyToId || null,
        replyToSender: parsed.replyToSender || null,
        replyToText: parsed.replyToText || null
      });
    } catch (e) {
      console.warn("⚠️ [LocalDatabase] Failed to decrypt local message row:", e);
    }
  }

  return decryptedRecords.reverse(); // Return in chronological order
};

// 4. Search Encrypted Message Store in O(1) using Blind Index Lookup
export const searchLocalMessages = async (chatId: string, searchWord: string): Promise<LocalMessageRecord[]> => {
  const db = await initLocalMessagesTable();
  const maskedChatId = maskId(chatId);

  // Hash query search word using Search Key
  const searchWordHmac = hmacSHA256(searchWord.toLowerCase().trim(), dbSearchKey);
  const truncatedSearchHash = Buffer.from(searchWordHmac, 'base64').slice(0, 16).toString('base64');

  // Exact Blind Index Lookup
  const query = `
    SELECT lm.* FROM local_messages lm
    INNER JOIN message_blind_indexes mbi ON lm.id = mbi.local_message_id
    WHERE lm.chat_id = ? AND mbi.word_hash = ?
    ORDER BY lm.timestamp DESC
  `;

  const rows = await db.getAllAsync<any>(query, [maskedChatId, truncatedSearchHash]);

  const decryptedRecords: LocalMessageRecord[] = [];

  for (const row of rows) {
    try {
      const decryptedStr = decryptMessageWithAES({
        ciphertext: row.encrypted_payload,
        iv: row.iv,
        tag: row.tag
      }, dbEnvelopeKey);

      const parsed = JSON.parse(decryptedStr);

      decryptedRecords.push({
        id: row.id,
        chatId: chatId,
        senderId: row.sender_id,
        timestamp: row.timestamp,
        text: parsed.text || '',
        attachment: parsed.attachment || null,
        isRead: row.is_read,
        replyToId: parsed.replyToId || null,
        replyToSender: parsed.replyToSender || null,
        replyToText: parsed.replyToText || null
      });
    } catch (e) {
      console.warn("⚠️ [LocalDatabase] Failed to decrypt searched message row:", e);
    }
  }

  return decryptedRecords;
};
