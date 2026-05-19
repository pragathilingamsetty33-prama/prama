import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal, LayoutAnimation, UIManager, AppState, AppStateStatus, ScrollView, InteractionManager } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Client } from '@stomp/stompjs';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import * as Sharing from 'expo-sharing';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { Send, ShieldCheck, ArrowLeft, Paperclip, Camera, FileText, X, Loader2, Forward, Download, Image as ImageIcon, Check, Reply } from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
// Legacy imports removed
import { 
  decryptAESKeyWithRSA, 
  decryptMessageWithAES, 
  generateAESKey, 
  encryptAESKeyWithRSA, 
  encryptMessageWithAES,
  decryptFileWithAES,
  encryptFileWithAES
} from '../../utils/crypto';
import { API_BASE_URL } from '../../constants/Config';
import forge from 'node-forge';
import { Buffer } from 'buffer';
import { MessageOrchestrator, SecureMessagePacket } from '../../utils/MessageOrchestrator';
import { ReceiptManager } from '../../utils/ReceiptManager';
import { encryptFile, decryptFile, isNativeCryptoAvailable } from '../../modules/aes-gcm-crypto/AesGcmCrypto';
import { IdentityManager } from '../../utils/IdentityManager';
import { GroupAdminService } from '../../utils/GroupAdminService';
import { BiometricManager } from '../../utils/BiometricManager';
import * as LocalAuthentication from 'expo-local-authentication';
import { globalAttachmentCache } from '../../utils/AttachmentCache';
import { decryptGroupMessageMegolm, enqueueGroupDecryption } from '../../utils/GroupRatchetEngine';
import { registerActiveTransfer, deregisterActiveTransfer } from '../../utils/ActiveTransfersRegistry';
import { saveLocalMessage, getLocalMessages, maskId } from '../../utils/LocalDatabase';

const computeSHA256Fingerprint = (pem: string) => {
  if (!pem) return "";
  try {
    const cleanPem = pem.replace(/-----BEGIN[^-]+-----|-----END[^-]+-----|\r|\n|\s/g, "");
    const md = forge.md.sha256.create();
    md.update(forge.util.decode64(cleanPem));
    const hex = md.digest().toHex().toUpperCase();
    return hex.match(/.{1,4}/g)?.join(':') || hex;
  } catch (err) {
    console.warn("Fingerprint hashing failed:", err);
    return "UNKNOWN FINGERPRINT";
  }
};

const decryptIncomingMessage = async (m: any, masterKey: Uint8Array, currentUserId: string, localCacheRef: { [key: string]: string }, preloadedPrivateKey?: string | null) => {
  try {
    if (!m || !(m.encryptedContent || m.encrypted_content || m.encryptedMessage || m.encrypted_message) || (m.encryptedContent || m.encrypted_content || m.encryptedMessage || m.encrypted_message) === 'undefined') {
      return { content: '[Empty/Unsupported Message]', attachment: null };
    }

    let content = "🔒 [Encrypted Message - Key Missing]";
    let attachment = null;

    const msgId = m.id || m.timestamp || 'UNKNOWN';

    const rawKeysMap = m.wrappedKeys || m.wrapped_keys || m.wrappedKeyMap || {};
    const isMsgGroup = !!m.groupId || !!m.group_id || Object.keys(rawKeysMap).length > 0;

    let actualKeysMap = rawKeysMap;
    if (rawKeysMap && rawKeysMap.type === 'json' && typeof rawKeysMap.value === 'string') {
      try {
        actualKeysMap = JSON.parse(rawKeysMap.value);
      } catch (e) {
        console.error("❌ [E2EE Decrypt] Failed to parse nested keysMap JSON string:", e);
      }
    } else if (typeof rawKeysMap === 'string') {
      try {
        actualKeysMap = JSON.parse(rawKeysMap);
      } catch (e) {}
    }

    const encryptedText = m.encryptedContent || m.encrypted_content || m.encryptedMessage || m.encrypted_message;
    const aesKeyToUse = isMsgGroup 
      ? ((actualKeysMap && actualKeysMap[currentUserId]) || m.encryptedAesKey || m.encrypted_aes_key || m.encryptedAESKey) 
      : (String(m.senderId) === String(currentUserId) 
          ? (m.senderEncryptedAesKey || m.sender_encrypted_aes_key || m.senderEncryptedAESKey) 
          : (m.encryptedAesKey || m.encrypted_aes_key || m.encryptedAESKey));

    if (aesKeyToUse && masterKey) {
      // 1. Retrieve private key Pem gracefully without halting
      let privateKeyPem = preloadedPrivateKey || null;
      if (!privateKeyPem) {
        try {
          privateKeyPem = await IdentityManager.getPrivateKey(masterKey);
        } catch (keyErr: any) {
          console.warn("⚠️ [E2EE Decrypt] Could not retrieve private key (clean device install?):", keyErr.message || keyErr);
        }
      }

      // 🚀 OPTIMIZATION: Read from fast memory cache first to protect the CPU thread
      let aesKeyStr = msgId !== 'UNKNOWN' ? localCacheRef[msgId] : null;

      if (!aesKeyStr && privateKeyPem) {
        try {
          aesKeyStr = decryptAESKeyWithRSA(aesKeyToUse, privateKeyPem);
          if (msgId !== 'UNKNOWN') {
            localCacheRef[msgId] = aesKeyStr as string; // Save to memory cache
          }
        } catch (rsaErr: any) {
          throw rsaErr;
        }
      }

      if (aesKeyStr) {
        // 3. Decrypt message payload
        let decryptedStr;
        try {
          decryptedStr = decryptMessageWithAES({
            ciphertext: encryptedText,
            iv: m.iv,
            tag: m.tag
          }, aesKeyStr);
        } catch (aesErr: any) {
          // SILENCED: console.error(...) was choking the JS bridge on legacy messages
          throw aesErr;
        }

        try {
          const parsed = JSON.parse(decryptedStr);
          content = parsed.text || "";
          attachment = parsed.attachment || null;
        } catch (e) {
          content = decryptedStr; // Fallback for plain text messages
        }
      } else {
        content = "🔒 [Encrypted Message - Key Missing]";
      }
    } else {
      content = "🔒 [Encrypted Message - Key Missing]";
    }

    return { content, attachment };
  } catch (error: any) {
    // SILENCED: console.error(...) was choking the JS bridge on legacy messages
    return { content: "[Decryption Failed]", attachment: null };
  }
};

const AttachmentViewer = ({ attachment, setSelectedImage, apiFetch, onForward }: { attachment: any, setSelectedImage: any, apiFetch: any, onForward: any }) => {
    const { user } = useAuth();
    const decryptedUrl = globalAttachmentCache[attachment.url] || null;
    const isDownloaded = !!decryptedUrl;
    const [isDecrypting, setIsDecrypting] = useState(false);
    const [localUrl, setLocalUrl] = useState<string | null>(null);
    const activeUrl = decryptedUrl || localUrl;

    useEffect(() => {
        const checkLocalCache = async () => {
            if (!attachment?.url) return;
            try {
                if (FileSystem) {
                    const safeName = attachment?.url?.replace(/[^a-zA-Z0-9]/g, '_') || 'temp_file';
                    const fileUri = FileSystem.documentDirectory + safeName;
                    const info = await FileSystem.getInfoAsync(fileUri);
                    if (info.exists) {
                        setLocalUrl(fileUri);
                        globalAttachmentCache[attachment.url] = fileUri;
                    }
                }
            } catch (e) {}
        };
        if (!decryptedUrl) {
            checkLocalCache();
        }
    }, [attachment.url, decryptedUrl]);

    const isImage = attachment.type?.startsWith('image/');
    const isVideo = attachment.type?.startsWith('video/');
    const isPPT = attachment.type?.includes('presentation') || attachment.name?.toLowerCase().endsWith('.ppt') || attachment.name?.toLowerCase().endsWith('.pptx');

      const handleDownloadAndDecrypt = async () => {
        setIsDecrypting(true);
        const safeName = attachment?.url?.replace(/[^a-zA-Z0-9]/g, '_') || 'temp_file';
        const fileUri = FileSystem.documentDirectory + safeName;
        
        try {
          if (attachment.version === 2) {
            console.log('⚡ [Downloader] Standard Raw Binary Stream Version 2 detected.');
            if (isNativeCryptoAvailable() && FileSystem && attachment.iv) {
              console.log('⚡ [Downloader] Native C++ streaming decryption engine active.');
              const tempEncPath = FileSystem.documentDirectory + 'download_' + (attachment.name || 'temp') + '.enc';
              
              registerActiveTransfer(tempEncPath);
              try {
                // 1. Download directly to cached encrypted file path
                const downloadResult = await FileSystem.downloadAsync(
                  `${API_BASE_URL}${attachment.url}`,
                  tempEncPath,
                  {
                    headers: {
                      'Authorization': 'Bearer ' + user?.accessToken
                    }
                  }
                );

                if (!downloadResult || downloadResult.status !== 200) {
                  throw new Error('Streaming download failed');
                }

                const baseIv = attachment.baseIv || attachment.iv;
                const fileId = attachment.messageId || attachment.iv;
                const jointIvParam = `${baseIv}:${fileId}`;

                // 2. Perform native low-level chunk decryption
                await decryptFile(
                  tempEncPath,
                  fileUri,
                  attachment.fileAesKey, // Already Base64 on mobile
                  jointIvParam
                );

                // 3. Clean up temp encrypted file
                await FileSystem.deleteAsync(tempEncPath, { idempotent: true });
                setLocalUrl(fileUri);
                globalAttachmentCache[attachment.url] = fileUri;
              } finally {
                deregisterActiveTransfer(tempEncPath);
                try {
                  await FileSystem.deleteAsync(tempEncPath, { idempotent: true });
                } catch (e) {}
              }
            } else {
              console.log('⚠️ [Downloader] Falling back to JS-heap in-memory raw binary decryption...');
              const expectedSize = attachment.expectedFileSize || attachment.size || 0;
              if (expectedSize > 5 * 1024 * 1024) {
                 Alert.alert('Unsupported', 'Native Cryptography Engine Unavailable - Cannot decrypt large files');
                 throw new Error('Native Cryptography Engine Unavailable - Cannot decrypt large files');
              }
              const res = await apiFetch(`${API_BASE_URL}${attachment.url}`);
              if (!res.ok) throw new Error('Download failed');
              
              const fileDataBuffer = await res.arrayBuffer();
              const totalLength = fileDataBuffer.byteLength;
              const ENCRYPTED_CHUNK_SIZE = 5 * 1024 * 1024 + 16;
              let remainingBytes = totalLength;
              let offset = 0;
              let chunkIndex = 0;

              const decryptedChunks: Uint8Array[] = [];

              const baseIv = attachment.baseIv || attachment.iv;
              const fileId = attachment.messageId || attachment.iv;

              let fileAesKey = attachment.fileAesKey;
              if (typeof fileAesKey === 'string' && fileAesKey.length !== 32) {
                fileAesKey = Buffer.from(fileAesKey, 'base64').toString('binary');
              }

              const decodedBaseIv = Buffer.from(baseIv, 'base64');

              while (remainingBytes > 0) {
                const currentChunkSize = Math.min(remainingBytes, ENCRYPTED_CHUNK_SIZE);
                const chunkView = new Uint8Array(fileDataBuffer, offset, currentChunkSize);

                // Derive deterministic chunk IV
                const ivBytes = new Uint8Array(12);
                for (let i = 0; i < 12; i++) ivBytes[i] = decodedBaseIv[i];
                const ivDv = new DataView(ivBytes.buffer);
                ivDv.setUint32(8, chunkIndex, false); // Big-Endian

                const cipherBytes = chunkView.slice(0, currentChunkSize - 16);
                const tagBytes = chunkView.slice(currentChunkSize - 16);

                const isEOF = remainingBytes <= ENCRYPTED_CHUNK_SIZE;
                const isLastChunkFlag = isEOF ? 1 : 0;

                // Reconstruct JSON string AAD header
                const aadString = JSON.stringify([fileId, chunkIndex, isLastChunkFlag]);
                const aadBinary = Buffer.from(aadString, 'utf8').toString('binary');

                const encryptedData = {
                  iv: Buffer.from(ivBytes).toString('base64'),
                  ciphertext: Buffer.from(cipherBytes).toString('base64'),
                  tag: Buffer.from(tagBytes).toString('base64')
                };

                const decryptedArrayBuffer = decryptFileWithAES(encryptedData, fileAesKey, aadBinary);
                decryptedChunks.push(new Uint8Array(decryptedArrayBuffer));

                chunkIndex++;
                offset += currentChunkSize;
                remainingBytes -= currentChunkSize;
              }

              // Combine all decrypted chunks into a single contiguous output buffer
              let totalPlainSize = 0;
              for (const c of decryptedChunks) totalPlainSize += c.length;
              const combinedPlain = new Uint8Array(totalPlainSize);
              let plainOffset = 0;
              for (const c of decryptedChunks) {
                combinedPlain.set(c, plainOffset);
                plainOffset += c.length;
              }

              const base64 = forge.util.encode64(Buffer.from(combinedPlain).toString('binary'));
              if (FileSystem) {
                await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
                setLocalUrl(fileUri);
                globalAttachmentCache[attachment.url] = fileUri;
              }
            }
          } else {
            console.log('⚠️ [Downloader] Legacy JSON attachment detected, running JS parser...');
            const res = await apiFetch(`${API_BASE_URL}${attachment.url}`);
            if (!res.ok) throw new Error('Download failed');
            
            const resText = await res.text();
            const encryptedData = JSON.parse(resText);
            
            let fileAesKey = attachment.fileAesKey;
            if (typeof fileAesKey === 'string' && fileAesKey.length !== 32) {
              fileAesKey = Buffer.from(fileAesKey, 'base64').toString('binary');
            }

            const decryptedArrayBuffer = decryptFileWithAES(encryptedData, fileAesKey);
            const base64 = forge.util.encode64(forge.util.createBuffer(decryptedArrayBuffer).getBytes());
            if (FileSystem) {
              await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
              setLocalUrl(fileUri);
              globalAttachmentCache[attachment.url] = fileUri;
            }
          }
        } catch (e: any) {
          console.error('❌ [Downloader] Attachment decryption failure:', e.message || e);
          Alert.alert('Error', 'Could not decrypt attachment.');
        }
        setIsDecrypting(false);
      };

    const handleSave = async () => {
        if (!activeUrl) return;
        try {
            if (Sharing && FileSystem && (await Sharing.isAvailableAsync())) {
                const fileName = attachment.name || "file";
                const shareTempDir = FileSystem.cacheDirectory + 'share_temp/';
                
                // Ensure share_temp directory exists
                const dirInfo = await FileSystem.getInfoAsync(shareTempDir);
                if (!dirInfo.exists) {
                    await FileSystem.makeDirectoryAsync(shareTempDir, { intermediates: true });
                }
                
                const fileUri = shareTempDir + fileName;
                // Read local file as base64 dynamically for native sharing
                const base64Data = await FileSystem.readAsStringAsync(activeUrl, { encoding: FileSystem.EncodingType.Base64 });
                await FileSystem.writeAsStringAsync(fileUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });
                await Sharing.shareAsync(fileUri);
            } else {
                await WebBrowser.openBrowserAsync(activeUrl);
            }
        } catch (err) {
            console.error("⚠️ [Sharing] Failed to execute share intent:", err);
            await WebBrowser.openBrowserAsync(activeUrl);
        }
    };

    if (isDecrypting) {
        return (
            <View style={[styles.attachmentContainer, { padding: 10, flexDirection: 'row', gap: 10 }]}>
                <ActivityIndicator size="small" color="#66fcf1" />
                <Text style={{ color: '#aaa', fontSize: 12 }}>Decrypting...</Text>
            </View>
        );
    }

    if (!isDownloaded) {
        return (
            <TouchableOpacity style={styles.attachmentContainer} onPress={handleDownloadAndDecrypt}>
                <View style={styles.fileContainer}>
                    {isImage ? <ImageIcon size={24} color="#66fcf1" /> : <FileText size={24} color="#66fcf1" />}
                    <View style={{ flex: 1 }}>
                        <Text style={styles.fileName} numberOfLines={1}>{attachment.name}</Text>
                        <Text style={{ color: '#888', fontSize: 10 }}>Tap to download ({attachment.type?.split('/')[1]?.toUpperCase() || 'FILE'})</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    }

    return (
        <View style={styles.attachmentContainer}>
            {isImage ? (
                <TouchableOpacity onPress={() => setSelectedImage(activeUrl)}>
                    <Image source={{ uri: activeUrl || undefined }} style={styles.attachmentImage} contentFit="cover" />
                </TouchableOpacity>
            ) : (
                <TouchableOpacity style={styles.fileContainer} onPress={handleSave}>
                    <FileText size={24} color="#66fcf1" />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.fileName} numberOfLines={1}>{attachment.name}</Text>
                        <Text style={{ color: '#888', fontSize: 10 }}>{attachment.type?.split('/')[1]?.toUpperCase() || 'FILE'}</Text>
                    </View>
                </TouchableOpacity>
            )}

            <TouchableOpacity 
                style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', padding: 6, borderRadius: 15 }} 
                onPress={() => onForward(attachment)}
            >
                <Forward color="#fff" size={16} />
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, paddingHorizontal: 4, paddingBottom: 4 }}>
                <TouchableOpacity 
                    style={[styles.downloadButton, { flex: 1, flexDirection: 'row', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' }]} 
                    onPress={() => isImage ? setSelectedImage(activeUrl) : handleSave()}
                >
                    <Text style={[styles.downloadText, { color: '#fff' }]}>Open</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                    style={[styles.downloadButton, { flex: 1, flexDirection: 'row', justifyContent: 'center' }]} 
                    onPress={handleSave}
                >
                    <Download color="#66fcf1" size={16} />
                    <Text style={[styles.downloadText, { marginLeft: 6 }]}>Save</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const shredDecryptedAttachment = (attachment: any) => {
  if (attachment && attachment.url && FileSystem) {
    try {
      const safeName = attachment.url.replace(/[^a-zA-Z0-9]/g, '_') || 'temp_file';
      const fileUri = FileSystem.documentDirectory + safeName;
      FileSystem.writeAsStringAsync(fileUri, "", { encoding: FileSystem.EncodingType.UTF8 })
        .then(() => {
          FileSystem.deleteAsync(fileUri, { idempotent: true });
          console.log(`🧹 [Shredder] Physically shredded attachment: ${safeName}`);
        })
        .catch(e => {
          console.warn(`⚠️ [Shredder] Failed to shred attachment: ${safeName}`, e);
        });
    } catch (err: any) {
      console.warn(`⚠️ [Shredder] Exception during shredding:`, err.message || err);
    }
  }
};

interface MessageRowProps {
  item: any;
  isMe: boolean;
  displayStatus: string;
  onLongPress: (item: any) => void;
  onSwipeOpen: (item: any) => void;
  currentlyOpenSwipeableRef: React.MutableRefObject<any>;
  activeSwipeIdRef: React.MutableRefObject<string | null>;
  setSelectedImage: (url: string | null) => void;
  apiFetch: any;
  onForward: (attachment: any) => void;
  messagesMap: Record<string, any>;
}

const MessageRow = React.memo(({
  item,
  isMe,
  displayStatus,
  onLongPress,
  onSwipeOpen,
  currentlyOpenSwipeableRef,
  activeSwipeIdRef,
  setSelectedImage,
  apiFetch,
  onForward,
  messagesMap
}: MessageRowProps) => {
  const swipeableRef = useRef<any>(null);

  if (item.isDeleted || item.is_deleted) {
    return (
      <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper, { marginVertical: 4, opacity: 0.6 }]}>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={14} color="#888" />
          <Text style={{ fontStyle: 'italic', color: '#888', fontSize: 11 }}>
            This message was deleted for everyone
          </Text>
        </View>
      </View>
    );
  }

  let clearText = item.content;
  if (item.isEdited || item.is_edited) {
    clearText += " (edited)";
  }

  const handleWillOpen = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentlyOpenSwipeableRef.current && currentlyOpenSwipeableRef.current !== swipeableRef.current) {
      try {
        currentlyOpenSwipeableRef.current.close();
      } catch (err) {}
    }
    currentlyOpenSwipeableRef.current = swipeableRef.current;
    activeSwipeIdRef.current = String(item.id);
  };

  const handleOpen = () => {
    onSwipeOpen(item);
    setTimeout(() => {
      try {
        swipeableRef.current?.close();
      } catch (err) {}
    }, 100);
  };

  const renderLeftActions = () => {
    return (
      <View style={styles.swipeReplyActionContainer}>
        <Reply color="#66fcf1" size={22} />
      </View>
    );
  };

  let replyText = null;
  let replySender = null;
  if (item.replyToId) {
    const parent = messagesMap[String(item.replyToId)];
    if (parent) {
      replySender = item.replyToSender || "Friend";
      replyText = parent.isDeleted ? "[Deleted Message]" : parent.content;
    } else {
      replySender = item.replyToSender || "Friend";
      replyText = item.replyToText || "🔒 [Message Encrypted/Unavailable]";
    }
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={renderLeftActions}
      onSwipeableWillOpen={handleWillOpen}
      onSwipeableOpen={handleOpen}
      leftThreshold={60}
      friction={2}
      failOffsetY={[-5, 5]}
      activeOffsetX={[-10, 10]}
    >
      <TouchableOpacity 
        activeOpacity={0.8}
        onLongPress={() => onLongPress(item)}
        style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}
      >
        <View style={[styles.messageBubble, isMe ? styles.myBubble : styles.theirBubble]}>
          {replyText && (
            <View style={styles.quotedMessageBlock}>
              <Text style={styles.quotedSenderText}>{replySender}</Text>
              <Text style={styles.quotedBodyText} numberOfLines={1}>
                {replyText}
              </Text>
            </View>
          )}
          {clearText ? (
            <Text style={[styles.messageText, isMe ? styles.myText : styles.theirText]}>
              {clearText}
            </Text>
          ) : null}
          {item.attachment && <AttachmentViewer attachment={item.attachment} setSelectedImage={setSelectedImage} apiFetch={apiFetch} onForward={onForward} />}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: 4, gap: 4 }}>
          <Text style={styles.messageTime}>{item.time}</Text>
          {isMe && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {displayStatus === 'SENT' && <Check color="#555" size={12} />}
              {(displayStatus === 'DELIVERED' || displayStatus === 'READ') && (
                <View style={{ flexDirection: 'row', marginLeft: -4 }}>
                  <Check color={displayStatus === 'READ' ? '#00ff88' : '#555'} size={12} />
                  <Check color={displayStatus === 'READ' ? '#00ff88' : '#555'} size={12} style={{ marginLeft: -8 }} />
                </View>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.content === nextProps.item.content &&
    prevProps.item.isEdited === nextProps.item.isEdited &&
    prevProps.item.isDeleted === nextProps.item.isDeleted &&
    prevProps.displayStatus === nextProps.displayStatus &&
    prevProps.messagesMap === nextProps.messagesMap
  );
});

export default function ChatScreen() {
  const localKeyCacheRef = useRef<{ [messageId: string]: string }>({});
  const { id: friendId, chatType } = useLocalSearchParams();
  const { user, keys, masterKey, apiFetch, getOrRefreshToken } = useAuth();
  const router = useRouter();
  
  const [isGroup, setIsGroup] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const keysRef = useRef(keys);
  const masterKeyRef = useRef(masterKey);
  const userRef = useRef(user);
  const friendIdRef = useRef(friendId);
  const isGroupRef = useRef(isGroup);
  const privateKeyRef = useRef<string | null>(null);
  const messagesRef = useRef<any[]>([]);

  // Synchronize refs to avoid stale closures in callback listeners
  useEffect(() => { keysRef.current = keys; }, [keys]);
  useEffect(() => { masterKeyRef.current = masterKey; }, [masterKey]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { friendIdRef.current = friendId; }, [friendId]);
  useEffect(() => { isGroupRef.current = isGroup; }, [isGroup]);
  useEffect(() => { privateKeyRef.current = privateKey; }, [privateKey]);

  const triggerBiometricUnlock = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Secure Prama Session',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });

      if (result.success) {
        console.log('🔓 [Biometrics] Unlock successful! Re-decrypting active keys...');
        if (masterKey) {
          masterKeyRef.current = masterKey;
          const key = await IdentityManager.getPrivateKey(masterKey);
          if (key) {
            setPrivateKey(key);
            privateKeyRef.current = key;
          }
        }
        setIsSessionLocked(false);
      } else {
        console.warn('❌ [Biometrics] Unlock failed or cancelled.');
      }
    } catch (e) {
      console.error('❌ [Biometrics] Error during local biometric authentication:', e);
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Load private key asynchronously and log when keys are loaded from SecureStore
  useEffect(() => {
    const loadPrivateKey = async () => {
      if (masterKey) {
        try {
          console.log("🔑 [ChatScreen] Attempting to load Private Key from SecureStore...");
          const key = await IdentityManager.getPrivateKey(masterKey);
          if (key) {
            setPrivateKey(key);
            console.log("🔑 [ChatScreen] Private Key loaded successfully from SecureStore.");
          } else {
            console.warn("⚠️ [ChatScreen] No private key found in SecureStore (empty key bundle).");
          }
        } catch (e: any) {
          console.error("❌ [ChatScreen] Error loading private key from SecureStore:", e.message || e);
        }
      } else {
        console.warn("⚠️ [ChatScreen] Cannot load private key: masterKey is missing.");
      }
    };
    loadPrivateKey();
  }, [masterKey, keys]);
  const [editGroupNameText, setEditGroupNameText] = useState("");
  const [isSavingGroupName, setIsSavingGroupName] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [groupRoster, setGroupRoster] = useState<any[]>([]);
  const [friend, setFriend] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [rawHistory, setRawHistory] = useState<any[]>([]);
  const [isDecryptingBatch, setIsDecryptingBatch] = useState(false);
  
  const messageBufferRef = useRef<any[]>([]);
  const throttleTimerRef = useRef<any>(null);

  const flushMessageBuffer = () => {
    if (messageBufferRef.current.length === 0) return;
    
    const messagesToFlush = [...messageBufferRef.current];
    messageBufferRef.current = []; // Clear buffer immediately
    
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMessages(prevMessages => {
        let updated = [...prevMessages];
        let hasChanges = false;
        
        for (const newMsg of messagesToFlush) {
            if (!updated.some(m => m.id === newMsg.id)) {
                updated = [newMsg, ...updated];
                hasChanges = true;
            }
        }
        return hasChanges ? updated : prevMessages;
    });
  };

  const scheduleFlush = () => {
      if (!throttleTimerRef.current) {
          throttleTimerRef.current = setTimeout(() => {
              flushMessageBuffer();
              throttleTimerRef.current = null;
          }, 50);
      }
  };

  useEffect(() => {
    return () => {
        if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            flushMessageBuffer();
        }
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [inputMsg, setInputMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const { stompClient: globalStompClient, isConnected, setActiveChatId } = useWebSocket();
  const stompClient = useRef<any>(null);

  useEffect(() => {
    stompClient.current = globalStompClient;
  }, [globalStompClient]);

  useEffect(() => {
    if (friendId) {
      setActiveChatId(String(friendId));
    }
    return () => {
      setActiveChatId(null);
    };
  }, [friendId]);
  const { showToast } = useToast();
  const flatListRef = useRef<FlatList>(null);
  const hasFetchedHistoryRef = useRef<string | null>(null);

  const [allFriends, setAllFriends] = useState<any[]>([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardingAttachment, setForwardingAttachment] = useState<any>(null);

  const [editingMessage, setEditingMessage] = useState<any>(null);
  const [longPressedMessage, setLongPressedMessage] = useState<any>(null);
  const [showActionsModal, setShowActionsModal] = useState(false);

  const [replyingToMessage, setReplyingToMessage] = useState<any | null>(null);
  const currentlyOpenSwipeable = useRef<any>(null);
  const activeSwipeId = useRef<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (replyingToMessage) {
      InteractionManager.runAfterInteractions(() => {
        inputRef.current?.focus();
      });
    }
  }, [replyingToMessage]);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [customAlias, setCustomAlias] = useState<string | null>(null);
  const [newAliasText, setNewAliasText] = useState("");
  const [friendPublicKey, setFriendPublicKey] = useState<string | null>(null);
  const [isFetchingPublicKey, setIsFetchingPublicKey] = useState(false);
  const blacklistedUserIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (showSettingsModal && !isGroup && friendId) {
      setIsFetchingPublicKey(true);
      apiFetch(`${API_BASE_URL}/api/v1/users/${friendId}/public-key`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && (data.publicKey || data.public_key)) {
            setFriendPublicKey(data.publicKey || data.public_key);
          }
        })
        .catch(err => console.warn("Failed to fetch friend public key for fingerprint:", err))
        .finally(() => setIsFetchingPublicKey(false));
    }
  }, [showSettingsModal, isGroup, friendId]);

  useEffect(() => {
    if (!user || !friendId) return;
    
    const initChat = async () => {
        setLoading(false); // Instantly release layout containers
        const groupFlag = chatType === 'group';
        setIsGroup(groupFlag);
        
        // Load custom friend display alias from local AsyncStorage
        if (!groupFlag) {
            import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) => {
                AsyncStorage.getItem(`@prama_alias_${friendId}`)
                    .then(alias => {
                        if (alias) {
                            setCustomAlias(alias);
                            setNewAliasText(alias);
                        }
                    });
            });
        }

        // 🚀 FIX 1: Fire history immediately in parallel. 
        // Messages don't need profile headers to render!
        fetchHistory(groupFlag);


        // 🚀 FIX 2: Dispatch metadata calls asynchronously in the background without blocking the loop
        if (groupFlag) {
            apiFetch(`${API_BASE_URL}/api/v1/groups/my-groups`)
                .then(res => res.ok ? res.json() : null)
                .then(myGroups => {
                    if (myGroups) {
                        const matchingGroup = myGroups.find((g: any) => String(g.groupId) === String(friendId));
                        if (matchingGroup) setGroupInfo(matchingGroup);
                    }
                }).catch(err => console.warn("Background groups fetch stalled:", err));

            apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/roster-keys`)
                .then(res => res.ok ? res.json() : null)
                .then(roster => {
                    if (roster) setGroupRoster(roster);
                }).catch(err => console.warn("Background roster fetch stalled:", err));
        } else {
            apiFetch(`${API_BASE_URL}/api/v1/friends`)
                .then(res => res.ok ? res.json() : null)
                .then(friendsList => {
                    if (friendsList) {
                        setAllFriends(friendsList);
                        const targetFriend = friendsList.find((fr: any) => String(fr.userId) === String(friendId));
                        if (targetFriend) {
                            setFriend(targetFriend);
                            // Synchronize server-synced alias with local state & storage fallback
                            if (targetFriend.alias) {
                                setCustomAlias(targetFriend.alias);
                                setNewAliasText(targetFriend.alias);
                                import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) => {
                                    AsyncStorage.setItem(`@prama_alias_${friendId}`, targetFriend.alias);
                                });
                            } else {
                                setCustomAlias(null);
                                setNewAliasText("");
                                import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) => {
                                    AsyncStorage.removeItem(`@prama_alias_${friendId}`);
                                });
                            }
                        }
                    }
                }).catch(err => console.warn("Background friends fetch stalled:", err));
        }
    };

    initChat();
  }, [friendId, chatType, user]);

  useEffect(() => {
    if (groupInfo) {
      setEditGroupNameText(groupInfo.name || groupInfo.groupName || "");
    }
  }, [groupInfo]);

  // 🚀 FIX: Pure state-driven reactive trigger with strict execution locking
  useEffect(() => {
    if (!user || !keys || !masterKey || !friendId) return;
    
    const fetchKey = `${friendId}_${chatType}`;
    if (hasFetchedHistoryRef.current === fetchKey) return;
    hasFetchedHistoryRef.current = fetchKey;
    
    const groupFlag = chatType === 'group';
    fetchHistory(groupFlag);
  }, [friendId, chatType, user, keys, masterKey]);

  const handleForwardClick = useCallback((attachment: any) => {
      setForwardingAttachment(attachment);
      setShowForwardModal(true);
  }, []);

  const handleLongPress = useCallback((item: any) => {
    setLongPressedMessage(item);
    setShowActionsModal(true);
  }, []);

  const handleSwipeOpen = useCallback((item: any) => {
    setReplyingToMessage(item);
  }, []);

  const messagesMap = useMemo(() => {
    const map: Record<string, any> = {};
    messages.forEach(m => {
      if (m.id) {
        map[String(m.id)] = m;
      }
    });
    return map;
  }, [messages]);

  const executeForward = async (recipientId: string) => {
      if (!stompClient.current?.connected) {
          Alert.alert('Connection Lost', 'WebSocket not connected.');
          return;
      }
      if (!keys) return;
      try {
          // Get recipient public key
          const pkRes = await apiFetch(`${API_BASE_URL}/api/v1/users/${recipientId}/public-key`);
          if (!pkRes.ok) throw new Error('Could not fetch public key');
          const latestPubKey = await pkRes.text();

          const aesKey = generateAESKey();
          const encryptedAESKey = encryptAESKeyWithRSA(aesKey, latestPubKey);
          const senderEncryptedAESKey = encryptAESKeyWithRSA(aesKey, keys.publicKey);
          
          const messagePayloadObj = {
              text: '', // No text, just attachment
              attachment: forwardingAttachment
          };
          
          const encryptedData = encryptMessageWithAES(JSON.stringify(messagePayloadObj), aesKey);

          const payload = {
              recipientId: recipientId,
              encryptedAESKey: encryptedAESKey,
              senderEncryptedAESKey: senderEncryptedAESKey,
              encryptedContent: encryptedData.ciphertext,
              iv: encryptedData.iv,
              tag: encryptedData.tag
          };

          stompClient.current.send("/app/chat.sendMessage", {}, JSON.stringify(payload));
          Alert.alert('Success', 'Attachment forwarded!');
      } catch (e) {
          Alert.alert('Error', 'Failed to forward attachment');
      } finally {
          setShowForwardModal(false);
          setForwardingAttachment(null);
      }
  };

  const fetchHistory = async (groupFlag: boolean) => {
    if (!keys || !masterKey || !user) return;
    
    try {
      setHistoryLoading(true);

      // ⚡ INSTANT SQLITE CACHE LOAD: Prioritize offline-first UX immediately
      try {
        const cachedMsgs = await getLocalMessages(String(friendId), 50);
        if (cachedMsgs.length > 0) {
          console.log(`⚡ [SQLite Vault] Instant-loaded ${cachedMsgs.length} messages from secure offline cache.`);
          const mappedCached = cachedMsgs.map(m => ({
            id: m.serverMessageHash || String(m.id),
            senderId: m.senderId,
            content: m.text,
            attachment: m.attachment,
            isMe: String(m.senderId) === String(user?.userId) || String(m.senderId) === maskId(String(user?.userId)),
            time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: new Date(m.timestamp).toISOString()
          }));
          setMessages(mappedCached.reverse());
        }
      } catch (e) {
        console.warn("⚠️ [LocalDatabase] Error loading cache on init:", e);
      }
      
      let endpoint = groupFlag
        ? `${API_BASE_URL}/api/v1/groups/${friendId}/messages`
        : `${API_BASE_URL}/api/v1/messages/${friendId}`;
        
      let res = await apiFetch(endpoint);
      
      // Self-healing adaptive path scanner
      if (groupFlag && (res.status === 404 || res.status === 405)) {
        endpoint = `${API_BASE_URL}/api/v1/messages/group/${friendId}`;
        res = await apiFetch(endpoint);
      }
      
      console.log(`📡 [Diagnostic] fetchHistory Path: ${endpoint} -> Status: ${res.status}`);
      
      if (res.ok) {
        const historyData = await res.json();
        
        // 🚀 UNIVERSAL DECODER: Defensively unpack every standard Spring Boot payload wrapper format
        let historyArray = [];
        if (Array.isArray(historyData)) {
          historyArray = historyData;
        } else if (historyData && typeof historyData === 'object') {
          historyArray = historyData.content || 
                         historyData.messages || 
                         historyData.data || 
                         historyData.chatLogs || 
                         [];
        }

        console.log(`📦 [Diagnostic] Extracted ${historyArray.length} historical entries for decryption processing.`);
        setRawHistory(historyArray);

        let currentPrivKey = privateKey || privateKeyRef.current;
        if (!currentPrivKey) {
          currentPrivKey = await IdentityManager.getPrivateKey(masterKey);
        }

        // Process the 15 most recent message objects to maximize UI thread performance
        const recentHistory = historyArray.length > 15 ? historyArray.slice(-15) : historyArray;

        const decryptedHistory: any[] = [];
        for (const m of recentHistory) {
          try {
            const { content, attachment } = await decryptIncomingMessage(m, masterKey, user.userId, localKeyCacheRef.current, currentPrivKey);
            decryptedHistory.push({
              ...m,
              content,
              attachment,
              isMe: String(m.senderId) === String(user?.userId),
              time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
          } catch (e) {
            decryptedHistory.push({
              ...m,
              content: '🔒 [Decryption Failed]',
              attachment: null,
              isMe: String(m.senderId) === String(user?.userId),
              time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
          }
          // ⚡ YIELD THE THREAD: yield to the event loop so the UI rendering stays perfectly smooth at 60 FPS!
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        setMessages(decryptedHistory.reverse());

        // Write-through caching of newly fetched history
        for (const m of decryptedHistory) {
          saveLocalMessage({
            serverMessageHash: m.id,
            chatId: String(friendId),
            senderId: String(m.senderId),
            timestamp: new Date(m.timestamp).getTime(),
            text: m.content,
            attachment: m.attachment,
            isRead: 1
          }).catch(e => console.error("Failed to write synced msg to local DB:", e));
        }
      } else {
        console.error('❌ [Diagnostic] Server history request failed with status:', res.status);
        // Do not overwrite local messages on failure to protect offline capability
      }
    } catch (e) {
      console.error('❌ [Diagnostic] Critical failure inside history processing queue:', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (isDecryptingBatch || !keys || !masterKey || !user || rawHistory.length === 0) return;
    if (messages.length >= rawHistory.length) return;

    try {
      setIsDecryptingBatch(true);
      console.log(`🔄 [Pagination] Starting lazy decryption batch. Decrypted: ${messages.length}/${rawHistory.length}`);

      let currentPrivKey = privateKey || privateKeyRef.current;
      if (!currentPrivKey) {
        currentPrivKey = await IdentityManager.getPrivateKey(masterKey);
      }

      const nextBatchSize = 15;
      const start = Math.max(0, rawHistory.length - messages.length - nextBatchSize);
      const end = rawHistory.length - messages.length;
      const nextBatch = rawHistory.slice(start, end);

      const decryptedBatch: any[] = [];
      for (const m of nextBatch) {
        try {
          const { content, attachment } = await decryptIncomingMessage(m, masterKey, user.userId, localKeyCacheRef.current, currentPrivKey);
          decryptedBatch.push({
            ...m,
            content,
            attachment,
            isMe: String(m.senderId) === String(user?.userId),
            time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        } catch (e) {
          decryptedBatch.push({
            ...m,
            content: '🔒 [Decryption Failed]',
            attachment: null,
            isMe: String(m.senderId) === String(user?.userId),
            time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }
        // ⚡ YIELD THE THREAD: Yield to layout compositor to maintain 60 FPS
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      setMessages(prev => {
        const combined = [...prev, ...decryptedBatch.reverse()];
        // De-duplicate defensively
        return combined.filter((msg, index, self) => 
          self.findIndex(m => m.id === msg.id) === index
        );
      });
      console.log(`✅ [Pagination] Successfully decrypted and appended 15 more historical messages.`);
    } catch (e) {
      console.error('❌ [Pagination] Failed to decrypt historical batch:', e);
    } finally {
      setIsDecryptingBatch(false);
    }
  };


  useEffect(() => {
    if (!stompClient.current || !isConnected || !friendId) return;

    const groupFlag = chatType === 'group';
    console.log('🔌 [WebSocket] Subscribing to chat topics using global STOMP client...');

    // 1. Subscribe to personal queue for private message details
    const personalTopic = `/topic/messages.${userRef.current?.userId}`;
    const personalSub = stompClient.current.subscribe(personalTopic, (msg: any) => {
        const payload = JSON.parse(msg.body);

        // 🚨 WEBSOCKET DISPATCH OVERRIDES FOR EDITS, REVOCATIONS, & ROLE MODERATIONS
        if (payload.type === 'MESSAGE_REVOKED') {
            handleIncomingRevocation(payload);
            return;
        }
        if (payload.type === 'MESSAGE_EDITED') {
            handleIncomingEdit(payload);
            return;
        }
        if (payload.type === 'ROLE_UPDATED' || payload.type === 'MEMBER_KICKED' || payload.type === 'MEMBER_ADDED' || payload.type === 'MEMBER_EXITED') {
            handleGroupRoleEvent(payload);
            return;
        }
        if (payload.type === 'RECEIPT_UPDATE' || payload.lastReadAt || payload.readAt) {
            const readerId = payload.readerId || payload.userId || payload.senderId;
            const receiptTime = payload.timestamp || payload.lastReadAt || new Date().toISOString();
            const receiptGroupId = payload.groupId || payload.group_id;

            if (receiptGroupId) {
                setGroupRoster(prev => prev.map(m => {
                    const mId = m.userId || m.id || m.user_id;
                    if (String(mId) === String(readerId)) {
                        return { ...m, lastReadAt: receiptTime, last_read_at: receiptTime };
                    }
                    return m;
                }));
            } else {
                setFriend((prev: any) => {
                    if (!prev) return prev;
                    const fId = prev.userId || prev.id || prev.user_id;
                    if (String(fId) === String(readerId)) {
                        return { ...prev, lastReadAt: receiptTime, last_read_at: receiptTime };
                    }
                    return prev;
                });
            }
            return;
        }

        const incomingSenderId = payload.senderId || payload.sender_id;
        const incomingRecipientId = payload.recipientId || payload.recipient_id;
        
        if (payload.status === 'DELIVERED' || payload.status === 'READ') {
            handleIncomingReceipt(payload);
        } else if (!groupFlag) {
            const isFromFriend = String(incomingSenderId) === String(friendIdRef.current);
            const isFromMeToThisFriend = String(incomingSenderId) === String(userRef.current?.userId) && String(incomingRecipientId) === String(friendIdRef.current);
            
            if (isFromFriend || isFromMeToThisFriend) {
                handleIncomingMessage(payload);
            }
        }
    });

    // 2. Subscribe to the active chat topic dynamically for Group/1-to-1 live sync
    let activeSub: any = null;
    if (friendIdRef.current !== userRef.current?.userId) {
        const activeChatTopic = groupFlag 
            ? `/topic/group.${friendIdRef.current}`
            : `/topic/messages.${friendIdRef.current}`;
            
        activeSub = stompClient.current.subscribe(activeChatTopic, (msg: any) => {
            const payload = JSON.parse(msg.body);

            // 🚨 WEBSOCKET DISPATCH OVERRIDES FOR EDITS, REVOCATIONS, & ROLE MODERATIONS
            if (payload.type === 'MESSAGE_REVOKED') {
                handleIncomingRevocation(payload);
                return;
            }
            if (payload.type === 'MESSAGE_EDITED') {
                handleIncomingEdit(payload);
                return;
            }
            if (payload.type === 'ROLE_UPDATED' || payload.type === 'MEMBER_KICKED' || payload.type === 'MEMBER_ADDED' || payload.type === 'MEMBER_EXITED') {
                handleGroupRoleEvent(payload);
                return;
            }
            if (payload.type === 'GROUP_DISSOLVED') {
                Alert.alert("🛡️ Conference Dissolved", "This E2EE secure group has been permanently dissolved by its administrator.");
                setShowSettingsModal(false);
                setMessages([]);
                messagesRef.current = [];
                router.replace('/(tabs)');
                return;
            }
            if (payload.type === 'GROUP_UPDATED') {
                setGroupInfo((prev: any) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        name: payload.name || prev.name,
                        groupAvatar: payload.avatar !== undefined ? payload.avatar : prev.groupAvatar
                    };
                });
                return;
            }
            if (payload.type === 'RECEIPT_UPDATE' || payload.lastReadAt || payload.readAt) {
                const readerId = payload.readerId || payload.userId || payload.senderId;
                const receiptTime = payload.timestamp || payload.lastReadAt || new Date().toISOString();
                const receiptGroupId = payload.groupId || payload.group_id;

                if (receiptGroupId) {
                    setGroupRoster(prev => prev.map(m => {
                        const mId = m.userId || m.id || m.user_id;
                        if (String(mId) === String(readerId)) {
                            return { ...m, lastReadAt: receiptTime, last_read_at: receiptTime };
                        }
                        return m;
                    }));
                } else {
                    setFriend((prev: any) => {
                        if (!prev) return prev;
                        const fId = prev.userId || prev.id || prev.user_id;
                        if (String(fId) === String(readerId)) {
                            return { ...prev, lastReadAt: receiptTime, last_read_at: receiptTime };
                        }
                        return prev;
                    });
                }
                return;
            }

            if (String(payload.senderId) === String(userRef.current?.userId)) {
                return;
            }
            handleIncomingMessage(payload);
        });
    }

    // AppState lifecycle listener inside the chat page only handles session locking and E2EE key wiping!
    // The socket connection is kept completely warm and managed globally!
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
        if (nextAppState.match(/inactive|background/)) {
            console.log('💤 [AppState] App backgrounded, wiping RAM keys and locking screen...');
            // WIPE E2EE key material from RAM instantly!
            setPrivateKey(null);
            privateKeyRef.current = null;
            masterKeyRef.current = null;
            
            // Gotcha 2: Clear local key cache on backgrounding to wipe active JS RAM keys!
            for (const k in localKeyCacheRef.current) {
                delete localKeyCacheRef.current[k];
            }
            
            // Activate screen privacy shield
            setIsSessionLocked(true);
        } else if (nextAppState === 'active') {
            console.log('☀️ [AppState] App active. Triggering foreground catch-up sync...');
            fetchHistory(groupFlag);
        }
    };
    const subscriptionAppState = AppState.addEventListener('change', handleAppStateChange);

    // 4. Clean Up active subscriptions
    return () => {
        console.log('🧹 [Cleanup] Tearing down chat subscriptions...');
        subscriptionAppState.remove();
        personalSub.unsubscribe();
        if (activeSub) {
            activeSub.unsubscribe();
        }
        
        // Forensically shred all active decrypted attachment files on exit!
        const activeMessages = messagesRef.current;
        if (activeMessages && activeMessages.length > 0) {
            activeMessages.forEach(m => {
                if (m.attachment) {
                    shredDecryptedAttachment(m.attachment);
                }
            });
        }
        
        // Gotcha 2: Clear local key cache on unmount to completely wipe active JS RAM key material!
        for (const k in localKeyCacheRef.current) {
            delete localKeyCacheRef.current[k];
        }
    };
  }, [friendId, chatType, isConnected]);

  const handleIncomingMessage = async (payload: any) => {
    const activeKeys = keysRef.current;
    const activeMasterKey = masterKeyRef.current;
    const activeUser = userRef.current;

    const senderId = payload.senderId || payload.sender_id;
    if (senderId && blacklistedUserIdsRef.current.has(String(senderId))) {
      console.warn(`🛡️ [Firewall] Dropped in-flight STOMP packet from blacklisted user: ${senderId}`);
      return;
    }

    if (!activeKeys || !activeMasterKey || !activeUser) {
      console.warn('⚠️ [WebSocket] Message decryption skipped: missing user session, keys, or masterKey.');
      return;
    }
    
    // Auto-ACK Delivery for 1-to-1 messages
    const isMsgGroup = !!payload.groupId || !!payload.group_id;

    if (!isMsgGroup) {
      ReceiptManager.acknowledgeDelivery(stompClient.current, payload, activeUser?.userId);
    }

    // Safe property alignment: Map encryptedMessage / encrypted_message to encryptedContent so decryption handles it cleanly
    if (payload.encryptedMessage && !payload.encryptedContent) {
      payload.encryptedContent = payload.encryptedMessage;
    }
    if (payload.encrypted_message && !payload.encryptedContent) {
      payload.encryptedContent = payload.encrypted_message;
    }
    if (payload.encrypted_content && !payload.encryptedContent) {
      payload.encryptedContent = payload.encrypted_content;
    }

    if (isMsgGroup && payload.sequenceNumber !== undefined) {
      // Phase 6 Megolm Engine integration with the UI Fast-Queue
      enqueueGroupDecryption(payload.groupId || payload.group_id, async () => {
         const plaintext = await decryptGroupMessageMegolm(
            payload.groupId || payload.group_id,
            payload.senderId || payload.sender_id,
            payload.sequenceNumber,
            payload.encryptedContent,
            payload.iv,
            payload.tag,
            payload.sessionId
         );
         
         const parsed = JSON.parse(plaintext);
         return JSON.stringify({
            content: parsed.text || "",
            attachment: parsed.attachment || null
         });
      }).then((resultStr: any) => {
          if (!resultStr) return;
          const result = JSON.parse(resultStr);
          const newDecryptedMessage = {
             id: payload.id || Date.now().toString(),
             senderId: payload.senderId,
             content: result.content,
             attachment: result.attachment,
             isMe: String(payload.senderId) === String(activeUser?.userId),
             status: payload.status || 'SENT',
             timestamp: payload.timestamp || new Date().toISOString(),
             isDeleted: !!payload.deleted || !!payload.isDeleted,
             isEdited: !!payload.edited || !!payload.isEdited,
             time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          messageBufferRef.current.push(newDecryptedMessage);
          scheduleFlush();

          // ⚡ Save incoming live group message to secure offline vault
          saveLocalMessage({
             serverMessageHash: newDecryptedMessage.id,
             chatId: String(friendIdRef.current),
             senderId: String(newDecryptedMessage.senderId),
             timestamp: new Date(newDecryptedMessage.timestamp).getTime(),
             text: newDecryptedMessage.content,
             attachment: newDecryptedMessage.attachment,
             isRead: 1
          }).catch(e => console.error("Failed to write incoming group msg to local DB:", e));
      }).catch(err => {
         console.warn("🛡️ [Megolm Engine] Message dropped by queue:", err);
      });
      return; // Do not process via legacy RSA
    }

    // Legacy / 1-to-1 RSA Decryption Fallback
    const { content: decryptedContent, attachment } = await decryptIncomingMessage(payload, activeMasterKey, activeUser.userId, localKeyCacheRef.current, privateKeyRef.current);

    const newDecryptedMessage = {
      id: payload.id || Date.now().toString(),
      senderId: payload.senderId,
      content: decryptedContent,
      attachment: attachment,
      isMe: String(payload.senderId) === String(activeUser?.userId),
      status: payload.status || 'SENT',
      timestamp: payload.timestamp || new Date().toISOString(),
      isDeleted: !!payload.deleted || !!payload.isDeleted,
      isEdited: !!payload.edited || !!payload.isEdited,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    messageBufferRef.current.push(newDecryptedMessage);
    scheduleFlush();

    // ⚡ Save incoming live 1-to-1 message to secure offline vault
    saveLocalMessage({
      serverMessageHash: newDecryptedMessage.id,
      chatId: String(friendIdRef.current),
      senderId: String(newDecryptedMessage.senderId),
      timestamp: new Date(newDecryptedMessage.timestamp).getTime(),
      text: newDecryptedMessage.content,
      attachment: newDecryptedMessage.attachment,
      isRead: 1
    }).catch(e => console.error("Failed to write incoming 1to1 msg to local DB:", e));

    // Fire READ receipt if currently viewing the chat
    if (!isMsgGroup) {
      ReceiptManager.acknowledgeRead(stompClient.current, newDecryptedMessage.id, payload.senderId, activeUser?.userId);
    }
  };

  const handleIncomingReceipt = (receipt: any) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === receipt.messageId) {
        return { ...msg, status: receipt.status };
      }
      return msg;
    }));
  };

  const handleIncomingRevocation = (payload: any) => {
    const targetId = payload.messageId || payload.id;
    if (activeSwipeId.current === String(targetId)) {
      currentlyOpenSwipeable.current = null;
      activeSwipeId.current = null;
    }
    if (replyingToMessage && String(replyingToMessage.id) === String(targetId)) {
      setReplyingToMessage(null);
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMessages(prev => prev.map(m => {
      if (String(m.id) === String(targetId)) {
        if (m.attachment) {
          shredDecryptedAttachment(m.attachment);
        }
        return {
          ...m,
          isDeleted: true,
          content: null,
          attachment: null
        };
      }
      return m;
    }));
  };

  const handleGroupRoleEvent = async (payload: any) => {
    if (!friendId || chatType !== 'group') return;
    
    const eventGroupId = payload.groupId || payload.group_id;
    if (eventGroupId && String(eventGroupId) !== String(friendId)) return;

    // Extract the freshly fanned-out key rotation map
    const rotatedKeys = payload.rotatedKeys || payload.rotated_keys;
    if (rotatedKeys && user?.userId) {
      const myWrappedKey = rotatedKeys[String(user.userId)];
      if (myWrappedKey && privateKeyRef.current) {
        try {
          // Un-wrap the new Group Master Key using RSA-OAEP
          const decryptedRotatedKey = decryptAESKeyWithRSA(myWrappedKey, privateKeyRef.current);
          
          // Overwrite the local cache for this active group E2EE session
          localKeyCacheRef.current[`group_${friendId}`] = decryptedRotatedKey;
          console.log("🔑 [E2EE Key Rotation] Successfully decrypted and cached rotated Group Master Key.");
        } catch (err) {
          console.error("❌ [E2EE Key Rotation Failure] RSA decryption failed:", err);
        }
      }
    }

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/roster-keys`);
      if (res.ok) {
        const newRoster = await res.json();
        const me = newRoster.find((m: any) => String(m.userId || m.id) === String(user?.userId));
        
        if (!me) {
          // Kicked from group!
          Alert.alert("🛡️ Security Access Revoked", "You have been removed from this secure group by an administrator.");
          setShowSettingsModal(false);
          setMessages([]);
          messagesRef.current = [];
          router.replace('/(tabs)');
        } else {
          const wasPreviouslyAdmin = groupRoster.find(m => String(m.userId || m.id) === String(user?.userId))?.isAdmin;
          const isCurrentlyAdmin = me.isAdmin || me.is_admin;
          
          if (wasPreviouslyAdmin && !isCurrentlyAdmin) {
            Alert.alert("🛡️ Privilege Update", "Your administrative privileges have been revoked by another moderator.");
            setShowSettingsModal(false);
          }
        }
        setGroupRoster(newRoster);
      }
    } catch (e) {
      console.warn("Failed to dynamically process administrative WebSocket role lock:", e);
    }
  };

  const handleIncomingEdit = async (payload: any) => {
    const targetId = payload.messageId || payload.id;
    const activeMasterKey = masterKeyRef.current;
    const activeUser = userRef.current;

    if (!activeMasterKey || !activeUser) return;

    // Retrieve the cached AES key for this message
    let aesKeyStr = localKeyCacheRef.current[targetId];

    // If not found, try to decrypt using the existing message
    if (!aesKeyStr) {
      const existingMsg = messagesRef.current.find(m => String(m.id) === String(targetId));
      if (existingMsg) {
        await decryptIncomingMessage(existingMsg, activeMasterKey, activeUser.userId, localKeyCacheRef.current, privateKeyRef.current);
        aesKeyStr = localKeyCacheRef.current[targetId];
      }
    }

    if (aesKeyStr) {
      try {
        const decryptedStr = decryptMessageWithAES({
          ciphertext: payload.encryptedContent || payload.encryptedMessage || payload.encrypted_message,
          iv: payload.iv,
          tag: payload.tag
        }, aesKeyStr);

        let content = "";
        try {
          const parsed = JSON.parse(decryptedStr);
          content = parsed.text || "";
        } catch (e) {
          content = decryptedStr;
        }

        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMessages(prev => {
          const parentExists = prev.some(m => String(m.id) === String(targetId));
          if (!parentExists) {
            // ⚠️ The "Orphaned Edit" Rendering Trap fallback
            return [{
              id: targetId || Date.now().toString(),
              senderId: payload.senderId,
              content: "Message edited (Original message unavailable)",
              isMe: String(payload.senderId) === String(activeUser.userId),
              status: 'SENT',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isOrphanedEdit: true
            }, ...prev];
          }

          return prev.map(m => {
            if (String(m.id) === String(targetId)) {
              return {
                ...m,
                isEdited: true,
                content: content
              };
            }
            return m;
          });
        });
      } catch (e) {
        console.error("Failed to decrypt live edited message:", e);
      }
    }
  };

  const confirmRevocation = (messageId: string) => {
    Alert.alert(
      "Delete Message",
      "Are you sure you want to delete this message for everyone?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => executeRevocation(messageId) }
      ]
    );
  };

  const executeRevocation = async (messageId: string) => {
    try {
      setIsUploading(true);
      if (activeSwipeId.current === String(messageId)) {
        currentlyOpenSwipeable.current = null;
        activeSwipeId.current = null;
      }
      if (replyingToMessage && String(replyingToMessage.id) === String(messageId)) {
        setReplyingToMessage(null);
      }
      const res = await apiFetch(`${API_BASE_URL}/api/v1/messages/${messageId}/revoke`, {
        method: 'DELETE'
      });

      if (res.ok) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMessages(prev => prev.map(m => {
          if (String(m.id) === String(messageId)) {
            if (m.attachment) {
              shredDecryptedAttachment(m.attachment);
            }
            return {
              ...m,
              isDeleted: true,
              content: null,
              attachment: null
            };
          }
          return m;
        }));
      } else {
        Alert.alert("Error", "Failed to revoke message.");
      }
    } catch (e) {
      console.error("Revocation failed", e);
      Alert.alert("Error", "Connection failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const executeEdit = async () => {
    if (!editingMessage) return;
    if (!inputMsg.trim()) return;

    try {
      setIsUploading(true);

      const targetId = editingMessage.id;
      let aesKeyStr = localKeyCacheRef.current[targetId];

      if (!aesKeyStr && masterKey && user) {
        await decryptIncomingMessage(editingMessage, masterKey, user.userId, localKeyCacheRef.current, privateKey);
        aesKeyStr = localKeyCacheRef.current[targetId];
      }

      if (!aesKeyStr) {
        Alert.alert("Encryption Error", "Could not retrieve the encryption key for this message.");
        return;
      }

      const messagePayloadObj = {
        text: inputMsg,
        attachment: editingMessage.attachment
      };

      const encryptedData = encryptMessageWithAES(JSON.stringify(messagePayloadObj), aesKeyStr);

      const res = await apiFetch(`${API_BASE_URL}/api/v1/messages/${targetId}/edit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          encryptedContent: encryptedData.ciphertext,
          iv: encryptedData.iv,
          tag: encryptedData.tag
        })
      });

      if (res.ok) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMessages(prev => prev.map(m => {
          if (String(m.id) === String(targetId)) {
            return {
              ...m,
              isEdited: true,
              content: inputMsg
            };
          }
          return m;
        }));

        setEditingMessage(null);
        setInputMsg("");
      } else {
        Alert.alert("Error", "Failed to update message on the server.");
      }
    } catch (e: any) {
      console.error("Error editing message:", e);
      Alert.alert("Error", "Cryptographic processing failed.");
    } finally {
      setIsUploading(false);
    }
  };

    const ActionsModalUI = () => (
      <Modal
        visible={showActionsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowActionsModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowActionsModal(false)}
        >
          <View style={styles.pickerContainer}>
            <Text style={styles.pickerTitle}>Message Actions</Text>
            
            {longPressedMessage?.isMe && !longPressedMessage?.isDeleted && (
              <>
                <TouchableOpacity 
                  style={styles.pickerItem} 
                  onPress={() => { 
                    setShowActionsModal(false); 
                    setEditingMessage(longPressedMessage);
                    setInputMsg(longPressedMessage.content || "");
                  }}
                >
                  <View style={[styles.pickerIcon, { backgroundColor: '#4a90e2' }]}>
                    <FileText color="#fff" size={20} />
                  </View>
                  <Text style={styles.pickerLabel}>Edit Message</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.pickerItem} 
                  onPress={() => { 
                    setShowActionsModal(false); 
                    confirmRevocation(longPressedMessage.id);
                  }}
                >
                  <View style={[styles.pickerIcon, { backgroundColor: '#ff6b6b' }]}>
                    <X color="#fff" size={20} />
                  </View>
                  <Text style={styles.pickerLabel}>Delete for Everyone</Text>
                </TouchableOpacity>
              </>
            )}

            {longPressedMessage && !longPressedMessage.isDeleted && (
              <TouchableOpacity 
                style={styles.pickerItem} 
                onPress={() => { 
                  setShowActionsModal(false); 
                  setReplyingToMessage(longPressedMessage);
                }}
              >
                <View style={[styles.pickerIcon, { backgroundColor: '#66fcf1' }]}>
                  <Reply color="#0b0c10" size={20} />
                </View>
                <Text style={styles.pickerLabel}>Reply</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowActionsModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    );

    const SettingsModalUI = () => {
      const [isSavingAlias, setIsSavingAlias] = useState(false);
      const [isTerminating, setIsTerminating] = useState(false);
      const [newMemberUsername, setNewMemberUsername] = useState("");
      const [isAddingMember, setIsAddingMember] = useState(false);

      const meInRoster = groupRoster.find(m => String(m.userId || m.id) === String(user?.userId));
      const isUserAdmin = meInRoster?.isAdmin || meInRoster?.is_admin || groupInfo?.creatorId === user?.userId;

      const handleSaveAlias = async () => {
        if (!friendId) return;
        setIsSavingAlias(true);
        const previousAlias = customAlias;
        const targetAlias = newAliasText.trim();
        
        try {
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          
          // 1. Optimistic Update (Immediate native feedback)
          if (targetAlias) {
            setCustomAlias(targetAlias);
            await AsyncStorage.setItem(`@prama_alias_${friendId}`, targetAlias);
          } else {
            setCustomAlias(null);
            await AsyncStorage.removeItem(`@prama_alias_${friendId}`);
          }
          
          // 2. Background Database Synchronization PUT Request
          const res = await apiFetch(`/api/v1/friends/${friendId}/alias`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias: targetAlias })
          });
          
          if (!res.ok) {
            throw new Error("Server synchronization failed.");
          }
          
          Alert.alert("Success", targetAlias ? "Nickname synchronized successfully!" : "Nickname cleared successfully!");
        } catch (err) {
          console.warn("⚠️ [Alias Sync] Failed to synchronize with server database:", err);
          
          // 3. Rollback State on Failure
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          if (previousAlias) {
            setCustomAlias(previousAlias);
            setNewAliasText(previousAlias);
            await AsyncStorage.setItem(`@prama_alias_${friendId}`, previousAlias);
          } else {
            setCustomAlias(null);
            setNewAliasText("");
            await AsyncStorage.removeItem(`@prama_alias_${friendId}`);
          }
          
          Alert.alert("⚠️ Sync Error", "Failed to sync nickname with server. Local rollback completed.");
        } finally {
          setIsSavingAlias(false);
        }
      };

      const handleTerminateFriendship = async () => {
        if (!friendId) return;
        Alert.alert(
          "⚠️ Terminate Friendship",
          "Are you sure you want to completely sever this secure connection? This will wipe all local messages, shred E2EE key material, and instantly delete cached media files.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Sever Connection",
              style: "destructive",
              onPress: async () => {
                setIsTerminating(true);
                try {
                  // 1. Immediately drop all future socket traffic from this sender
                  blacklistedUserIdsRef.current.add(String(friendId));

                  // 2. Call backend termination API
                  await apiFetch(`${API_BASE_URL}/api/v1/friends/${friendId}/terminate`, {
                    method: 'DELETE'
                  });

                  // 3. Clear local states & memory caches
                  setMessages([]);
                  messagesRef.current = [];
                  setPrivateKey(null);
                  privateKeyRef.current = null;
                  masterKeyRef.current = null;
                  if (friendId) {
                      delete localKeyCacheRef.current[String(friendId)];
                      delete localKeyCacheRef.current[`group_${friendId}`];
                  }

                  // 4. Forensically shred all cached decrypted attachment files
                  const activeMessages = messagesRef.current;
                  if (activeMessages && activeMessages.length > 0) {
                      activeMessages.forEach(m => {
                          if (m.attachment) {
                              shredDecryptedAttachment(m.attachment);
                          }
                      });
                  }

                  setShowSettingsModal(false);
                  Alert.alert("Connection Severed", "Secure relationship has been deleted.");
                  router.replace('/(tabs)');
                } catch (err) {
                  Alert.alert("Error", "Termination request failed.");
                } finally {
                  setIsTerminating(false);
                }
              }
            }
          ]
        );
      };

      const handleUpdateGroupName = async () => {
        if (!editGroupNameText.trim()) return;
        setIsSavingGroupName(true);
        try {
          const res = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editGroupNameText.trim() })
          });
          if (res.ok) {
            Alert.alert("Success", "Group name updated successfully!");
            setGroupInfo((prev: any) => prev ? { ...prev, name: editGroupNameText.trim() } : prev);
          } else {
            throw new Error(await res.text());
          }
        } catch (err: any) {
          Alert.alert("Error", err.message || "Failed to update group name.");
        } finally {
          setIsSavingGroupName(false);
        }
      };

      const handlePickGroupAvatar = async () => {
        try {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.2, // Fit database sizes safely
            allowsEditing: true,
            aspect: [1, 1],
            base64: true
          });

          if (!result.canceled && result.assets && result.assets[0].base64) {
            setIsUploadingAvatar(true);
            const base64Img = `data:image/jpeg;base64,${result.assets[0].base64}`;
            
            const res = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/update`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ avatar: base64Img })
            });
            if (res.ok) {
              Alert.alert("Success", "Group avatar updated successfully!");
              setGroupInfo((prev: any) => prev ? { ...prev, groupAvatar: base64Img } : prev);
            } else {
              throw new Error(await res.text());
            }
          }
        } catch (err: any) {
          Alert.alert("Error", err.message || "Failed to update group avatar.");
        } finally {
          setIsUploadingAvatar(false);
        }
      };

      const handleAddMember = async () => {
        if (!newMemberUsername.trim()) return;
        setIsAddingMember(true);
        try {
          // 1. Find user public key bundle first
          const pkRes = await apiFetch(`${API_BASE_URL}/api/v1/users/${newMemberUsername.trim()}/public-key`);
          if (!pkRes.ok) {
            throw new Error("Could not find public key for this user.");
          }
          const pkData = await pkRes.json();
          const targetUserId = pkData.userId;
          const targetPublicKey = pkData.publicKey || pkData.public_key;

          if (!targetPublicKey) {
              throw new Error("Could not resolve target's public key.");
          }

          // We must share the ACTIVE group key with the new member
          const currentGroupKeyStr = localKeyCacheRef.current[`group_${friendId}`];
          if (!currentGroupKeyStr) {
              throw new Error("Local group cryptographic context is missing. Cannot wrap key for new member.");
          }

          const encryptedGroupKey = encryptAESKeyWithRSA(currentGroupKeyStr, targetPublicKey);

          // 2. Add member via GroupAdminService REST binding
          await GroupAdminService.addMember(String(friendId), targetUserId, encryptedGroupKey, apiFetch);

          Alert.alert("Success", `${newMemberUsername} added to the group!`);
          setNewMemberUsername("");
          
          // Re-fetch roster keys
          const rosterRes = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/roster-keys`);
          if (rosterRes.ok) {
            setGroupRoster(await rosterRes.json());
          }
        } catch (err: any) {
          Alert.alert("Error", err.message || "Failed to add member.");
        } finally {
          setIsAddingMember(false);
        }
      };

      const handleLeaveGroup = async () => {
        Alert.alert(
          "Leave Group",
          "Are you sure you want to exit this E2EE group? You will lose future decryption streams.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Leave",
              style: "destructive",
              onPress: async () => {
                try {
                  // Forward Secrecy: Generate new cryptographic epoch
                  const newGroupKey = generateAESKey();
                  const remainingRoster = groupRoster.filter(m => String(m.userId || m.id) !== String(user?.userId));
                  const newEncryptedKeys: Record<string, string> = {};

                  for (let i = 0; i < remainingRoster.length; i++) {
                    const member = remainingRoster[i];
                    const mId = member.userId || member.id;
                    const mPubKey = member.publicKey || member.public_key;
                    if (mPubKey) {
                        newEncryptedKeys[String(mId)] = encryptAESKeyWithRSA(newGroupKey, mPubKey);
                    }
                    if (i % 5 === 0) await new Promise(resolve => setTimeout(resolve, 10));
                  }

                  await GroupAdminService.exitGroup(String(friendId), newEncryptedKeys, apiFetch);
                  
                  // Shred group local caches
                  delete localKeyCacheRef.current[`group_${friendId}`];
                  setMessages([]);
                  messagesRef.current = [];
                  setShowSettingsModal(false);
                  router.replace('/(tabs)');
                } catch (err: any) {
                  Alert.alert("Error", err.message || "Failed to leave group.");
                }
              }
            }
          ]
        );
      };

      const handleKickMember = async (targetUserId: string, targetName: string) => {
        Alert.alert(
          "Kick Member",
          `Are you sure you want to remove ${targetName} from this group?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Kick",
              style: "destructive",
              onPress: async () => {
                try {
                  // Forward Secrecy: Generate new cryptographic epoch
                  const newGroupKey = generateAESKey();
                  const remainingRoster = groupRoster.filter(m => String(m.userId || m.id) !== String(targetUserId));
                  const newEncryptedKeys: Record<string, string> = {};

                  for (let i = 0; i < remainingRoster.length; i++) {
                    const member = remainingRoster[i];
                    const mId = member.userId || member.id;
                    const mPubKey = member.publicKey || member.public_key;
                    if (mPubKey) {
                        newEncryptedKeys[String(mId)] = encryptAESKeyWithRSA(newGroupKey, mPubKey);
                    }
                    if (i % 5 === 0) await new Promise(resolve => setTimeout(resolve, 10));
                  }

                  await GroupAdminService.removeMember(String(friendId), targetUserId, newEncryptedKeys, apiFetch);
                  
                  // Instantly mutate local memory cache to the new epoch to prevent self-lockout
                  localKeyCacheRef.current[`group_${friendId}`] = newGroupKey;
                  
                  Alert.alert("Evicted", `${targetName} has been kicked.`);
                  // Re-fetch roster
                  const rosterRes = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/roster-keys`);
                  if (rosterRes.ok) {
                    setGroupRoster(await rosterRes.json());
                  }
                } catch (err: any) {
                  Alert.alert("Error", err.message || "Failed to kick member.");
                }
              }
            }
          ]
        );
      };

      const handleModerateMember = async (targetUserId: string, targetName: string, isCurrentlyAdmin: boolean) => {
        if (!friendId) return;

        const options = [];

        // 1. Show Promote or Demote option based on current role
        if (isCurrentlyAdmin) {
          options.push({
            text: "Demote to Member",
            onPress: async () => {
              try {
                const res = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/demote/${targetUserId}`, {
                  method: 'PUT'
                });
                if (!res.ok) throw new Error(await res.text());
                
                Alert.alert("Success", `${targetName} demoted to standard member.`);
                // Re-fetch roster keys
                const rosterRes = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/roster-keys`);
                if (rosterRes.ok) {
                  setGroupRoster(await rosterRes.json());
                }
              } catch (err: any) {
                Alert.alert("Error", err.message || "Failed to demote member.");
              }
            }
          });
        } else {
          options.push({
            text: "Promote to Admin",
            onPress: async () => {
              try {
                const res = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/promote/${targetUserId}`, {
                  method: 'PUT'
                });
                if (!res.ok) throw new Error(await res.text());
                
                Alert.alert("Success", `${targetName} promoted to group admin.`);
                // Re-fetch roster keys
                const rosterRes = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/roster-keys`);
                if (rosterRes.ok) {
                  setGroupRoster(await rosterRes.json());
                }
              } catch (err: any) {
                Alert.alert("Error", err.message || "Failed to promote member.");
              }
            }
          });
        }

        // 2. Add Kick option
        options.push({
          text: "Kick Member",
          style: "destructive" as const,
          onPress: () => handleKickMember(targetUserId, targetName)
        });

        // 3. Add Cancel option
        options.push({
          text: "Cancel",
          style: "cancel" as const,
          onPress: () => {}
        });

        Alert.alert(
          "🛡️ Moderate Member",
          `Select an administrative moderation action for ${targetName}:`,
          options
        );
      };

      return (
        <Modal
          visible={showSettingsModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowSettingsModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.pickerContainer, { maxHeight: '80%' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={styles.pickerTitle}>{isGroup ? "Group Settings" : "Friend Details"}</Text>
                <TouchableOpacity onPress={() => setShowSettingsModal(false)}>
                  <Text style={{ color: '#66fcf1', fontWeight: 'bold' }}>Done</Text>
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={{ paddingBottom: 30 }} style={{ width: '100%' }}>
                {isGroup ? (
                  // GROUP CONTROLS
                  <View style={{ width: '100%' }}>
                    <Text style={{ color: '#45a29e', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Group Roster ({groupRoster?.length || 0})</Text>
                    {groupRoster.map((item) => (
                      <View key={String(item.userId || item.id || Math.random())} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1f2833', padding: 12, borderRadius: 8, marginBottom: 8, width: '100%' }}>
                        <View>
                          <Text style={{ color: '#fff', fontWeight: 'bold' }}>{item.username || item.userId}</Text>
                          <Text style={{ color: '#888', fontSize: 12 }}>{item.isAdmin || item.is_admin ? "👑 Admin" : "Member"}</Text>
                        </View>
                        {/* Unified Moderation Options for Group Admins */}
                        {isUserAdmin && item.userId !== user?.userId && (
                          <TouchableOpacity 
                            style={{ backgroundColor: '#45a29e', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                            onPress={() => handleModerateMember(item.userId, item.username || item.userId, !!(item.isAdmin || item.is_admin))}
                          >
                            <Text style={{ color: '#0b0c10', fontSize: 12, fontWeight: 'bold' }}>Manage</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}

                    {/* Group Customization Section (Admin Allowed) */}
                    {isUserAdmin && (
                      <View style={{ marginTop: 20, width: '100%' }}>
                        <Text style={{ color: '#45a29e', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Group Customization</Text>
                        <View style={{ flexDirection: 'row', width: '100%', marginBottom: 10 }}>
                          <TextInput
                            style={{ flex: 1, backgroundColor: '#1f2833', color: '#fff', padding: 10, borderRadius: 8, marginRight: 8 }}
                            placeholder="Change group name..."
                            placeholderTextColor="#888"
                            value={editGroupNameText}
                            onChangeText={setEditGroupNameText}
                          />
                          <TouchableOpacity 
                            style={{ backgroundColor: '#66fcf1', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 8 }}
                            onPress={handleUpdateGroupName}
                            disabled={isSavingGroupName}
                          >
                            {isSavingGroupName ? (
                              <ActivityIndicator size="small" color="#0b0c10" />
                            ) : (
                              <Text style={{ color: '#0b0c10', fontWeight: 'bold' }}>Save</Text>
                            )}
                          </TouchableOpacity>
                        </View>

                        <TouchableOpacity 
                          style={{ backgroundColor: 'rgba(102, 252, 241, 0.1)', borderWidth: 1, borderColor: '#66fcf1', padding: 12, borderRadius: 8, alignItems: 'center', width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                          onPress={handlePickGroupAvatar}
                          disabled={isUploadingAvatar}
                        >
                          {isUploadingAvatar ? (
                            <ActivityIndicator size="small" color="#66fcf1" />
                          ) : (
                            <>
                              <ImageIcon color="#66fcf1" size={16} />
                              <Text style={{ color: '#66fcf1', fontWeight: 'bold' }}>Change Group Avatar</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Add Member Section (Admin Allowed) */}
                    {isUserAdmin && (
                      <View style={{ marginTop: 20, width: '100%' }}>
                        <Text style={{ color: '#45a29e', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Add New Member</Text>
                        <View style={{ flexDirection: 'row', width: '100%' }}>
                          <TextInput
                            style={{ flex: 1, backgroundColor: '#1f2833', color: '#fff', padding: 10, borderRadius: 8, marginRight: 8 }}
                            placeholder="Enter username..."
                            placeholderTextColor="#888"
                            value={newMemberUsername}
                            onChangeText={setNewMemberUsername}
                            autoCapitalize="none"
                          />
                          <TouchableOpacity 
                            style={{ backgroundColor: '#66fcf1', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 8 }}
                            onPress={handleAddMember}
                            disabled={isAddingMember}
                          >
                            {isAddingMember ? (
                              <ActivityIndicator size="small" color="#0b0c10" />
                            ) : (
                              <Text style={{ color: '#0b0c10', fontWeight: 'bold' }}>Add</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    <TouchableOpacity 
                      style={{ backgroundColor: '#ff6b6b', padding: 14, borderRadius: 8, marginTop: 30, alignItems: 'center', width: '100%' }}
                      onPress={handleLeaveGroup}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>Leave Group</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  // PRIVATE FRIEND CUSTOMIZATIONS
                  <View style={{ width: '100%' }}>
                    <Text style={{ color: '#45a29e', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Personalized Nickname</Text>
                    <View style={{ flexDirection: 'row', marginBottom: 30, width: '100%' }}>
                      <TextInput
                        style={{ flex: 1, backgroundColor: '#1f2833', color: '#fff', padding: 10, borderRadius: 8, marginRight: 8 }}
                        placeholder="Set nickname..."
                        placeholderTextColor="#888"
                        value={newAliasText}
                        onChangeText={setNewAliasText}
                      />
                      <TouchableOpacity 
                        style={{ backgroundColor: '#66fcf1', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 8 }}
                        onPress={handleSaveAlias}
                        disabled={isSavingAlias}
                      >
                        <Text style={{ color: '#0b0c10', fontWeight: 'bold' }}>Save</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={{ color: '#45a29e', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Cryptographic Safety Number</Text>
                    {isFetchingPublicKey ? (
                      <ActivityIndicator color="#66fcf1" style={{ alignSelf: 'flex-start', marginVertical: 10 }} />
                    ) : friendPublicKey ? (
                      <View style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(102, 252, 241, 0.1)', padding: 12, borderRadius: 8, marginBottom: 25 }}>
                        <Text style={{ color: '#66fcf1', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 1.5, textAlign: 'center', lineHeight: 18 }}>
                          {computeSHA256Fingerprint(friendPublicKey)}
                        </Text>
                        <Text style={{ color: '#888', fontSize: 10, textAlign: 'center', marginTop: 8 }}>
                          Verify this SHA-256 fingerprint out-of-band to ensure zero-knowledge session integrity.
                        </Text>
                      </View>
                    ) : (
                      <Text style={{ color: '#888', fontSize: 12, fontStyle: 'italic', marginBottom: 25 }}>Fingerprint unavailable.</Text>
                    )}

                    <Text style={{ color: '#45a29e', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Relationship Security</Text>
                    <TouchableOpacity 
                      style={{ backgroundColor: '#ff6b6b', padding: 14, borderRadius: 8, alignItems: 'center', width: '100%' }}
                      onPress={handleTerminateFriendship}
                      disabled={isTerminating}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                        {isTerminating ? "Severing connection..." : "Terminate Friendship"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      );
    };

    const ImagePickerModal = () => (
      <Modal
        visible={showPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowPicker(false)}
        >
          <View style={styles.pickerContainer}>
            <Text style={styles.pickerTitle}>Choose Attachment</Text>
            
            <TouchableOpacity style={styles.pickerItem} onPress={() => { setShowPicker(false); pickImage(); }}>
              <View style={[styles.pickerIcon, { backgroundColor: '#4a90e2' }]}>
                <Paperclip color="#fff" size={20} />
              </View>
              <Text style={styles.pickerLabel}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickerItem} onPress={() => { setShowPicker(false); takePhoto(); }}>
              <View style={[styles.pickerIcon, { backgroundColor: '#e24a4a' }]}>
                <Camera color="#fff" size={20} />
              </View>
              <Text style={styles.pickerLabel}>Camera</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickerItem} onPress={() => { setShowPicker(false); pickDocument(); }}>
              <View style={[styles.pickerIcon, { backgroundColor: '#4ae24a' }]}>
                <FileText color="#fff" size={20} />
              </View>
              <Text style={styles.pickerLabel}>Document</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowPicker(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    );

    const ForwardModalUI = () => (
      <Modal
        visible={showForwardModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowForwardModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowForwardModal(false)}
        >
          <View style={[styles.pickerContainer, { maxHeight: '60%' }]}>
            <Text style={styles.pickerTitle}>Forward to...</Text>
            <FlatList 
                data={allFriends.filter(f => f.userId !== friendId)}
                keyExtractor={item => item.userId}
                renderItem={({item}) => (
                    <TouchableOpacity style={styles.pickerItem} onPress={() => executeForward(item.userId)}>
                        <View style={styles.friendAvatar}>
                            <Text style={styles.friendAvatarText}>{item.username?.charAt(0)?.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.pickerLabel}>{item.username}</Text>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{color: '#888', padding: 20}}>No other friends to forward to.</Text>}
            />
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowForwardModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    );

    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setSelectedFile({
        uri: asset.uri,
        name: asset.fileName || `image_${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      });
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Camera access is required to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setSelectedFile({
        uri: asset.uri,
        name: asset.fileName || `photo_${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      });
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setSelectedFile({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/octet-stream',
      });
    }
  };

  const sendMessage = async () => {
    if (editingMessage) {
      executeEdit();
      return;
    }

    if (!inputMsg.trim() && !selectedFile) return;
    
    if (!stompClient.current?.connected) {
      Alert.alert('Connection Lost', 'The real-time connection to the server is down. Please wait a moment or check your internet.');
      return;
    }

    if (!keys) {
      Alert.alert('Security Error', 'Encryption keys not found. Please log in again.');
      return;
    }

    try {
      setIsUploading(true);

      let attachmentData = null;
      if (selectedFile) {
        // 1. Encrypt the file using the native 8KB streaming module
        const tempEncPath = FileSystem.documentDirectory + selectedFile.name + '.enc';
        registerActiveTransfer(tempEncPath);
        try {
          const fileAesKey = forge.random.getBytesSync(32);
          const { iv: fileIv } = await encryptFile(selectedFile.uri, tempEncPath, Buffer.from(fileAesKey, 'binary').toString('base64'));

          // 2. Upload to the direct streaming backend endpoint
          const uploadResponseData = await new Promise<any>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', `${API_BASE_URL}/api/v1/streaming-upload`);
              xhr.setRequestHeader('Authorization', 'Bearer ' + user?.accessToken);
              xhr.setRequestHeader('X-File-Name', selectedFile.name + '.enc');
              xhr.setRequestHeader('X-Sender-Id', user!.userId);
              
              xhr.onload = () => {
                  if (xhr.status >= 200 && xhr.status < 300) {
                      resolve(JSON.parse(xhr.response));
                  } else {
                      reject(new Error(`Streaming upload failed with status ${xhr.status}`));
                  }
              };
              xhr.onerror = () => reject(new Error('Network request failed'));
              
              // Send as blob to respect memory limits
              fetch(tempEncPath).then(r => r.blob()).then(blob => xhr.send(blob));
          });

          const ivParts = fileIv.split(':');
          const baseIvBase64 = ivParts[0];
          const fileId = ivParts.length > 1 ? ivParts[1] : fileIv;

          attachmentData = {
            url: uploadResponseData.url,
            type: selectedFile.type,
            name: selectedFile.name,
            fileAesKey: Buffer.from(fileAesKey, 'binary').toString('base64'),
            baseIv: baseIvBase64,
            messageId: fileId,
            expectedFileSize: selectedFile.size,
            version: 2 // 🚀 INDICATES RAW BINARY STREAM STANDARD
          };
        } finally {
          deregisterActiveTransfer(tempEncPath);
          try {
            await FileSystem.deleteAsync(tempEncPath, { idempotent: true });
            console.log(`🧹 [Uploader] Cleanly deleted temporary encrypted native file: ${selectedFile.name}`);
          } catch (deleteErr) {
            console.warn("⚠️ [Uploader] Failed to delete temp file:", deleteErr);
          }
        }
      }

      const aesKey = generateAESKey();
      const messagePayloadObj = {
        text: inputMsg,
        attachment: attachmentData,
        replyToId: replyingToMessage ? replyingToMessage.id : null,
        replyToSender: replyingToMessage ? (replyingToMessage.isMe ? "You" : (friend?.username || "Friend")) : null,
        replyToText: replyingToMessage ? replyingToMessage.content : null
      };

      const encryptedData = encryptMessageWithAES(JSON.stringify(messagePayloadObj), aesKey);

      if (isGroup) {
        let roster = groupRoster;
        if (roster.length === 0) {
          try {
            const rosterRes = await apiFetch(`${API_BASE_URL}/api/v1/groups/${friendId}/roster-keys`);
            if (rosterRes.ok) {
              roster = await rosterRes.json();
              setGroupRoster(roster);
            }
          } catch (e) {
            console.error("Failed to fetch group roster keys", e);
          }
        }

        const wrappedKeys: { [userId: string]: string } = {};
        if (roster && roster.length > 0) {
          const batchSize = 5;
          for (let i = 0; i < roster.length; i += batchSize) {
            const batch = roster.slice(i, i + batchSize);
            await Promise.all(batch.map(async (member) => {
              const mId = member.userId || member.id;
              const pubKey = member.publicKey || member.public_key;
              if (mId && pubKey) {
                try {
                  wrappedKeys[mId] = encryptAESKeyWithRSA(aesKey, pubKey);
                } catch (e) {
                  console.error("Group member RSA wrap failed:", mId, e);
                }
              }
            }));
            // Yield the thread to keep UI updates buttery smooth
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        if (Object.keys(wrappedKeys).length === 0) {
          throw new Error("wrappedKeys map is empty");
        }

        const groupPayload = {
          groupId: friendId,
          senderId: user?.userId,
          encryptedContent: encryptedData.ciphertext,
          iv: encryptedData.iv,
          tag: encryptedData.tag,
          wrappedKeys: wrappedKeys
        };

        stompClient.current.send("/app/chat.groupMessage", {}, JSON.stringify(groupPayload));
      } else {
        // Get recipient public key
        const pkRes = await apiFetch(`${API_BASE_URL}/api/v1/users/${friendId}/public-key`);
        if (!pkRes.ok) throw new Error('Could not fetch public key');
        const latestPubKey = await pkRes.text();

        const encryptedAESKey = encryptAESKeyWithRSA(aesKey, latestPubKey);
        const senderEncryptedAESKey = encryptAESKeyWithRSA(aesKey, keys.publicKey);

        const payload = {
          recipientId: friendId,
          encryptedAESKey: encryptedAESKey,
          senderEncryptedAESKey: senderEncryptedAESKey,
          encryptedContent: encryptedData.ciphertext,
          encryptedMessage: encryptedData.ciphertext, // Mirror key for Web Client compliance
          iv: encryptedData.iv,
          tag: encryptedData.tag
        };

        stompClient.current.send("/app/chat.sendMessage", {}, JSON.stringify(payload));
      }

      // Slide existing list up, ease new bubble in, and morph inputs in a single batched frame
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const localMsgId = Date.now().toString();
      setMessages((prevMessages) => [{
        id: localMsgId,
        content: inputMsg,
        attachment: attachmentData,
        isMe: true,
        status: 'SENT',
        timestamp: new Date().toISOString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        replyToId: replyingToMessage ? replyingToMessage.id : null,
        replyToSender: replyingToMessage ? (replyingToMessage.isMe ? "You" : (friend?.username || "Friend")) : null,
        replyToText: replyingToMessage ? replyingToMessage.content : null
      }, ...prevMessages]);

      // ⚡ Save outgoing message synchronously to SQLite offline vault
      saveLocalMessage({
        serverMessageHash: localMsgId,
        chatId: String(friendId),
        senderId: String(user?.userId),
        timestamp: Date.now(),
        text: inputMsg,
        attachment: attachmentData,
        isRead: 1,
        replyToId: replyingToMessage ? replyingToMessage.id : null,
        replyToSender: replyingToMessage ? (replyingToMessage.isMe ? "You" : (friend?.username || "Friend")) : null,
        replyToText: replyingToMessage ? replyingToMessage.content : null
      }).catch(e => console.error("Failed to write outgoing message to local DB:", e));
      
      setReplyingToMessage(null);
      setInputMsg('');
      setSelectedFile(null);
      setIsUploading(false);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to send encrypted message');
      setIsUploading(false);
    }
  };

  if (isSessionLocked) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0c10', flex: 1 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ alignItems: 'center', padding: 20 }}>
          <ShieldCheck color="#66fcf1" size={80} style={{ marginBottom: 20 }} />
          <Text style={{ color: '#66fcf1', fontSize: 22, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' }}>Secure Session Locked</Text>
          <Text style={{ color: '#aaa', fontSize: 14, textAlign: 'center', marginBottom: 30, lineHeight: 20, maxWidth: 280 }}>
            This Prama session is cryptographically locked to protect your E2EE privacy from multitasking snapshots and background dumps.
          </Text>
          <TouchableOpacity 
            style={{ 
              backgroundColor: '#66fcf1', 
              paddingVertical: 14, 
              paddingHorizontal: 28, 
              borderRadius: 10, 
              flexDirection: 'row', 
              alignItems: 'center'
            }}
            onPress={triggerBiometricUnlock}
          >
            <ShieldCheck color="#0b0c10" size={20} style={{ marginRight: 8 }} />
            <Text style={{ color: '#0b0c10', fontSize: 16, fontWeight: 'bold' }}>Tap to Unlock Session</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#66fcf1" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color="#66fcf1" size={24} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.headerInfo} 
          onPress={() => { 
            setShowSettingsModal(true); 
            setNewAliasText(customAlias || friend?.username || ""); 
          }}
        >
          <Text style={styles.friendName}>
            {isGroup ? (groupInfo?.name || groupInfo?.groupName || 'Group Chat') : (customAlias || friend?.username || 'Chat')}
          </Text>
          <View style={styles.secureBadge}>
            <ShieldCheck color="#00ff88" size={12} />
            <Text style={styles.secureText}>End-to-end encrypted</Text>
          </View>
        </TouchableOpacity>
      </View>

      {historyLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0c10' }}>
          <ActivityIndicator size="large" color="#66fcf1" />
          <Text style={{ color: '#45a29e', fontSize: 13, marginTop: 15, fontWeight: '500' }}>
            🔒 Unlocking end-to-end encrypted chat thread...
          </Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 }}>
          <ShieldCheck color="#45a29e" size={48} opacity={0.4} style={{ marginBottom: 15 }} />
          <Text style={{ color: '#66fcf1', fontSize: 14, textAlign: 'center', fontWeight: '500' }}>
            No secure messages parsed yet. Send a live message below to initialize!
          </Text>
        </View>
      ) : (
        <FlatList 
          ref={flatListRef}
          data={messages}
          inverted={true}
          extraData={{ friend, groupRoster, messages }}
          keyExtractor={(item) => item.id || `msg-${item.timestamp}`}
          onEndReached={loadMoreHistory}
          onEndReachedThreshold={0.2}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          renderItem={({ item }) => {
            const isMe = item.isMe;
            let displayStatus = item.status || 'SENT';

            if (isMe) {
              if (isGroup) {
                // Calculate displayStatus dynamically based on groupRoster lastReadAt timestamps
                const others = groupRoster.filter(m => {
                  const mId = m.userId || m.id || m.user_id;
                  return String(mId) !== String(user?.userId);
                });

                const msgTime = item.timestamp ? new Date(item.timestamp).getTime() : Date.now();

                const allRead = others.length > 0 && others.every(m => {
                  const readAtStr = m.lastReadAt || m.last_read_at || m.lastRead;
                  if (!readAtStr) return false;
                  const memberReadTime = new Date(readAtStr).getTime();
                  return memberReadTime >= msgTime;
                });

                const someRead = others.some(m => {
                  const readAtStr = m.lastReadAt || m.last_read_at || m.lastRead;
                  if (!readAtStr) return false;
                  const memberReadTime = new Date(readAtStr).getTime();
                  return memberReadTime >= msgTime;
                });

                displayStatus = allRead ? 'READ' : (someRead ? 'DELIVERED' : 'SENT');
              } else if (friend) {
                // Calculate displayStatus dynamically based on friend lastReadAt timestamp
                const friendReadStr = friend?.lastReadAt || friend?.last_read_at || friend?.lastRead;
                let friendReadTime = friendReadStr ? new Date(friendReadStr).getTime() : 0;
                if (isNaN(friendReadTime)) friendReadTime = 0;

                const msgTime = item.timestamp ? new Date(item.timestamp).getTime() : Date.now();
                const isRead = friendReadTime >= msgTime;

                displayStatus = isRead ? 'READ' : (item.status || 'SENT');
              }
            }

            return (
              <MessageRow
                item={item}
                isMe={isMe}
                displayStatus={displayStatus}
                onLongPress={handleLongPress}
                onSwipeOpen={handleSwipeOpen}
                currentlyOpenSwipeableRef={currentlyOpenSwipeable}
                activeSwipeIdRef={activeSwipeId}
                setSelectedImage={setSelectedImage}
                apiFetch={apiFetch}
                onForward={handleForwardClick}
                messagesMap={messagesMap}
              />
            );
          }}
          contentContainerStyle={styles.listContent}
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={10}
        />
      )}

      {selectedFile && (
        <View style={styles.previewContainer}>
          <FileText color="#66fcf1" size={20} />
          <Text style={styles.previewText} numberOfLines={1}>{selectedFile.name}</Text>
          <TouchableOpacity onPress={() => setSelectedFile(null)}>
            <X color="#ff6b6b" size={20} />
          </TouchableOpacity>
        </View>
      )}

      {editingMessage && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2833', paddingHorizontal: 15, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(102, 252, 241, 0.1)', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <FileText size={16} color="#66fcf1" />
            <Text style={{ color: '#fff', fontSize: 12 }} numberOfLines={1}>
              Editing: {editingMessage.content}
            </Text>
          </View>
          <TouchableOpacity onPress={() => { setEditingMessage(null); setInputMsg(""); }}>
            <X color="#ff6b6b" size={18} />
          </TouchableOpacity>
        </View>
      )}

      {replyingToMessage && (
        <View style={styles.replyPreviewContainer}>
          <View style={styles.replyPreviewLine} />
          <View style={{ flex: 1, paddingLeft: 8 }}>
            <Text style={{ color: '#66fcf1', fontSize: 11, fontWeight: 'bold' }}>
              Replying to {replyingToMessage.isMe ? "yourself" : (friend?.username || "Friend")}
            </Text>
            <Text style={{ color: '#aaa', fontSize: 12 }} numberOfLines={1}>
              {replyingToMessage.content}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyingToMessage(null)}>
            <X color="#ff6b6b" size={18} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputArea}>
        <TouchableOpacity 
          style={styles.attachButton} 
          onPress={() => setShowPicker(true)}
          disabled={isUploading}
        >
          <Paperclip color="#66fcf1" size={20} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.attachButton} 
          onPress={takePhoto}
          disabled={isUploading}
        >
          <Camera color="#66fcf1" size={20} />
        </TouchableOpacity>
        <TextInput 
          ref={inputRef}
          style={styles.input}
          placeholder="Type an encrypted message..."
          placeholderTextColor="#888"
          value={inputMsg}
          onChangeText={setInputMsg}
          multiline
          editable={!isUploading}
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage} disabled={isUploading}>
          {isUploading ? <Loader2 color="#0b0c10" size={20} className="animate-spin" /> : <Send color="#0b0c10" size={20} />}
        </TouchableOpacity>
      </View>
      
      <ForwardModalUI />
      <ImagePickerModal />
      <ActionsModalUI />
      <SettingsModalUI />

      {/* Full Screen Image Viewer */}
      {selectedImage && (
        <Modal transparent={true} visible={!!selectedImage} animationType="fade">
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={styles.closeModal} onPress={() => setSelectedImage(null)}>
              <X color="#fff" size={32} />
            </TouchableOpacity>
            <Image 
              source={{ uri: selectedImage }} 
              style={styles.fullImage} 
              contentFit="contain" 
            />
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0c10',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0b0c10',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    paddingTop: 50,
    backgroundColor: 'rgba(31, 40, 51, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(102, 252, 241, 0.1)',
  },
  backButton: {
    marginRight: 15,
  },
  headerInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  secureText: {
    fontSize: 10,
    color: '#00ff88',
  },
  listContent: {
    padding: 20,
    gap: 15,
  },
  messageWrapper: {
    maxWidth: '80%',
  },
  myMessageWrapper: {
    alignSelf: 'flex-end',
  },
  theirMessageWrapper: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    padding: 12,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  myBubble: {
    backgroundColor: '#66fcf1',
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  myText: {
    color: '#0b0c10',
  },
  theirText: {
    color: '#fff',
  },
  messageTime: {
    fontSize: 10,
    color: '#555',
    marginTop: 4,
    marginHorizontal: 4,
    textAlign: 'right',
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    paddingBottom: Platform.OS === 'ios' ? 30 : 15,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(11, 12, 16, 0.9)',
    gap: 8,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(31, 40, 51, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(31, 40, 51, 0.5)',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    color: '#fff',
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#66fcf1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(102, 252, 241, 0.1)',
    padding: 10,
    marginHorizontal: 15,
    marginBottom: 10,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.2)',
  },
  previewText: {
    fontSize: 14,
    flex: 1,
  },
  attachmentContainer: {
    marginTop: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 4,
  },
  attachmentImage: {
    width: 200,
    height: 150,
    borderRadius: 6,
  },
  fileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
  },
  fileName: {
    fontSize: 14,
    color: '#fff',
    flex: 1,
  },
  downloadButton: {
    backgroundColor: 'rgba(102, 252, 241, 0.2)',
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.3)',
  },
  downloadText: {
    color: '#66fcf1',
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeModal: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  fullImage: {
    width: '100%',
    height: '80%',
  },
  pickerContainer: {
    backgroundColor: '#1f2833',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
  pickerTitle: {
    color: '#66fcf1',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  pickerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  pickerLabel: {
    color: '#fff',
    fontSize: 16,
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#45a29e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  friendAvatarText: {
    color: '#0b0c10',
    fontWeight: 'bold',
    fontSize: 16,
  },
  cancelButton: {
    marginTop: 15,
    paddingVertical: 15,
    alignItems: 'center',
  },
  cancelText: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '600',
  },
  swipeReplyActionContainer: {
    width: 70,
    backgroundColor: 'rgba(102, 252, 241, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    marginVertical: 4,
  },
  quotedMessageBlock: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderLeftWidth: 3,
    borderLeftColor: '#66fcf1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 6,
    minWidth: 120,
  },
  quotedSenderText: {
    color: '#66fcf1',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  quotedBodyText: {
    color: '#ccc',
    fontSize: 12,
  },
  replyPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2833',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(102, 252, 241, 0.1)',
    justifyContent: 'space-between',
  },
  replyPreviewLine: {
    width: 3,
    height: '100%',
    backgroundColor: '#66fcf1',
    borderRadius: 1.5,
  },
});
