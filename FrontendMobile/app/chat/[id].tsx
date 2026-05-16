import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';

// Safe require for native modules to prevent crashes
let Sharing = null;
try {
    Sharing = require('expo-sharing');
} catch (e) {
}
import { useAuth } from '../../context/AuthContext';
import { Send, ShieldCheck, ArrowLeft, Paperclip, Camera, FileText, X, Loader2, Forward, Download, Image as ImageIcon } from 'lucide-react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import SockJS from 'sockjs-client';
import { Stomp } from '@stomp/stompjs';
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
import { encryptFile, decryptFile } from '../../modules/aes-gcm-crypto/AesGcmCrypto';



// Global cache to persist attachments across different chat screens during the session
const globalAttachmentCache: { [url: string]: string } = {};

const AttachmentViewer = ({ attachment, setSelectedImage, apiFetch, onForward }: { attachment: any, setSelectedImage: any, apiFetch: any, onForward: any }) => {
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
                    const safeName = attachment.url.replace(/[^a-zA-Z0-9]/g, '_');
                    const fileUri = FileSystem.documentDirectory + safeName;
                    const info = await FileSystem.getInfoAsync(fileUri);
                    if (info.exists) {
                        const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
                        const dataUrl = `data:${attachment.type};base64,${base64}`;
                        setLocalUrl(dataUrl);
                        globalAttachmentCache[attachment.url] = dataUrl;
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
        try {
          const res = await apiFetch(`${API_BASE_URL}${attachment.url}`);
          if (!res.ok) throw new Error('Download failed');
          const resText = await res.text();
          const encryptedData = JSON.parse(resText);
          // Decode the base64‑encoded AES key stored on the attachment
          let fileAesKey = attachment.fileAesKey;
          if (typeof fileAesKey === 'string') {
            // mobile stores the key as base64 string
            fileAesKey = Buffer.from(fileAesKey, 'base64').toString('binary');
          }
          const decryptedArrayBuffer = decryptFileWithAES(encryptedData, fileAesKey);
          const base64 = forge.util.encode64(forge.util.createBuffer(decryptedArrayBuffer).getBytes());
          const dataUrl = `data:${attachment.type};base64,${base64}`;
          try {
            if (FileSystem) {
              const safeName = attachment.url.replace(/[^a-zA-Z0-9]/g, '_');
              const fileUri = FileSystem.documentDirectory + safeName;
              await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
            }
          } catch (e) {
            console.warn('Could not cache to FS', e);
          }
          setLocalUrl(dataUrl);
          globalAttachmentCache[attachment.url] = dataUrl;
        } catch (e) {
          Alert.alert('Error', 'Could not decrypt attachment.');
        }
        setIsDecrypting(false);
      };

    const handleSave = async () => {
        if (!activeUrl) return;
        try {
            if (Sharing && FileSystemNative && (await Sharing.isAvailableAsync())) {
                const fileName = attachment.name || "file";
                const fileUri = FileSystem.cacheDirectory + fileName;
                const base64Data = activeUrl.split(',')[1];
                await FileSystem.writeAsStringAsync(fileUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });
                await Sharing.shareAsync(fileUri);
            } else {
                await WebBrowser.openBrowserAsync(activeUrl);
            }
        } catch (err) {
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
                    <Image source={{ uri: activeUrl }} style={styles.attachmentImage} contentFit="cover" />
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

export default function ChatScreen() {
  const { id: friendId } = useLocalSearchParams();
  const { user, keys, apiFetch } = useAuth();
  const router = useRouter();
  
  const [friend, setFriend] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const stompClient = useRef<any>(null);

  const [allFriends, setAllFriends] = useState<any[]>([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardingAttachment, setForwardingAttachment] = useState<any>(null);

  useEffect(() => {
    if (!user || !friendId) return;
    
    const initChat = async () => {
        await fetchFriendInfo();
        await fetchHistory();
        connectWebSocket();
        setLoading(false);
    };

    initChat();

    return () => {
      if (stompClient.current) {
        stompClient.current.disconnect();
      }
    };
  }, [friendId, user]);

  const fetchFriendInfo = async () => {
      try {
          const res = await apiFetch(`${API_BASE_URL}/api/v1/friends`);
          if (res.ok) {
              const friendsList = await res.json();
              setAllFriends(friendsList);
              const f = friendsList.find((fr: any) => fr.userId === friendId);
              setFriend(f);
          }
      } catch (e) {
          console.error(e);
      }
  };

  const handleForwardClick = (attachment: any) => {
      setForwardingAttachment(attachment);
      setShowForwardModal(true);
  };

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
              encryptedMessage: JSON.stringify(encryptedData)
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

  const fetchHistory = async () => {
    if (!keys || !masterKey) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/messages/${friendId}`);
      if (res.ok) {
        const history = await res.json();
        const decryptedHistory = history.map((m: any) => {
          let content = "[Encrypted]";
          let attachment = null;
          try {
            const aesKeyToUse = (m.senderId === user?.userId) ? m.senderEncryptedAesKey : m.encryptedAesKey;
            if (aesKeyToUse && masterKey) {
              const decryptedStr = await MessageOrchestrator.decryptIncoming(m, masterKey);
              // Web sends messages as JSON: {"text":"...","attachment":...}
              try {
                const parsed = JSON.parse(decryptedStr);
                content = parsed.text || "";
                attachment = parsed.attachment || null;
              } catch(e) {
                content = decryptedStr; // Fallback for plain text messages
              }
            }
          } catch (e) {
          }
          return {
            ...m,
            content,
            attachment,
            isMe: m.senderId === user?.userId,
            time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
        });
        setMessages(decryptedHistory);
      }
    } catch (e) {
      console.error('Failed to load history', e);
    }
  };

  const connectWebSocket = () => {
    if (stompClient.current?.connected) return;

    // Use the Bypass header for the WebSocket handshake
    const client = Stomp.over(() => new SockJS(`${API_BASE_URL}/ws`));
    client.debug = (msg) => console.log('WebSocket:', msg);

    client.connect({
      'Authorization': 'Bearer ' + user?.accessToken,
    }, () => {
      client.subscribe(`/topic/messages/${user?.userId}`, (msg: any) => {
        const payload = JSON.parse(msg.body);
        if (payload.status === 'DELIVERED' || payload.status === 'READ') {
          handleIncomingReceipt(payload);
        } else if (payload.senderId === friendId) {
          handleIncomingMessage(payload);
        }
      });
    }, (error: any) => {
      console.error('❌ WebSocket error', error);
      // Attempt reconnect after 5 seconds
      setTimeout(connectWebSocket, 5000);
    });

    stompClient.current = client;
  };

  const handleIncomingMessage = async (payload: any) => {
    if (!keys || !masterKey) return;
    
    // Auto-ACK Delivery
    ReceiptManager.acknowledgeDelivery(stompClient.current, payload, user?.userId);

    let decryptedContent = '🔒 [Decryption failed]';
    let attachment = null;
    try {
      const decryptedStr = await MessageOrchestrator.decryptIncoming(payload, masterKey);
      try {
        const parsed = JSON.parse(decryptedStr);
        decryptedContent = parsed.text || "";
        attachment = parsed.attachment || null;
      } catch(e) {
        decryptedContent = decryptedStr; 
      }
    } catch (error) {
      console.error('Decryption failed', error);
    }

    const newMsg = {
      id: payload.id || Date.now().toString(),
      senderId: payload.senderId,
      content: decryptedContent,
      attachment: attachment,
      isMe: false,
      status: 'SENT',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, newMsg]);

    // Fire READ receipt if currently viewing the chat
    ReceiptManager.acknowledgeRead(stompClient.current, newMsg.id, payload.senderId, user?.userId);
  };

  const handleIncomingReceipt = (receipt: any) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === receipt.messageId) {
        return { ...msg, status: receipt.status };
      }
      return msg;
    }));
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
    if (!inputMsg.trim() && !selectedFile) return;
    
    if (!stompClient.current?.connected) {
      Alert.alert('Connection Lost', 'The real-time connection to the server is down. Please wait a moment or check your internet.');
      connectWebSocket(); // Try to reconnect
      return;
    }

    if (!keys) {
      Alert.alert('Security Error', 'Encryption keys not found. Please log in again.');
      return;
    }

    try {
      setIsUploading(true);
      // Get recipient public key
      const pkRes = await apiFetch(`${API_BASE_URL}/api/v1/users/${friendId}/public-key`);
      if (!pkRes.ok) throw new Error('Could not fetch public key');
      const latestPubKey = await pkRes.text();

      let attachmentData = null;
      if (selectedFile) {
        // 1. Encrypt the file using the native 8KB streaming module
        const tempEncPath = FileSystem.documentDirectory + selectedFile.name + '.enc';
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
            fetch(selectedFile.uri).then(r => r.blob()).then(blob => xhr.send(blob));
        });

        attachmentData = {
          url: uploadResponseData.url,
          type: selectedFile.type,
          name: selectedFile.name,
          fileAesKey: Buffer.from(fileAesKey, 'binary').toString('base64'),
          iv: fileIv
        };
      }

      const messagePayloadObj = {
        text: inputMsg,
        attachment: attachmentData
      };

      if (!masterKey) throw new Error('MasterKey missing');

      const packet = await MessageOrchestrator.encryptForRecipient(
        friendId as string,
        user!.userId,
        JSON.stringify(messagePayloadObj),
        masterKey
      );

      stompClient.current.send("/app/chat.sendMessage", {}, JSON.stringify(packet));

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content: inputMsg,
        attachment: attachmentData,
        isMe: true,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      
      setInputMsg('');
      setSelectedFile(null);
      setIsUploading(false);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to send encrypted message');
      setIsUploading(false);
    }
  };

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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color="#66fcf1" size={24} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.friendName}>{friend?.username || 'Chat'}</Text>
          <View style={styles.secureBadge}>
            <ShieldCheck color="#00ff88" size={12} />
            <Text style={styles.secureText}>End-to-end encrypted</Text>
          </View>
        </View>
      </View>

      <FlatList 
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.messageWrapper, item.isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
            <View style={[styles.messageBubble, item.isMe ? styles.myBubble : styles.theirBubble]}>
              {item.content ? (
                <Text style={[styles.messageText, item.isMe ? styles.myText : styles.theirText]}>
                  {item.content}
                </Text>
              ) : null}
              {item.attachment && <AttachmentViewer attachment={item.attachment} setSelectedImage={setSelectedImage} apiFetch={apiFetch} onForward={handleForwardClick} />}
            </View>
            <Text style={styles.messageTime}>{item.time}</Text>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />

      {selectedFile && (
        <View style={styles.previewContainer}>
          <FileText color="#66fcf1" size={20} />
          <Text style={styles.previewText} numberOfLines={1}>{selectedFile.name}</Text>
          <TouchableOpacity onPress={() => setSelectedFile(null)}>
            <X color="#ff6b6b" size={20} />
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
        <TextInput 
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
});
