import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { Send, ShieldCheck, ArrowLeft } from 'lucide-react-native';
import SockJS from 'sockjs-client';
import { Stomp } from '@stomp/stompjs';
import { 
  decryptAESKeyWithRSA, 
  decryptMessageWithAES, 
  generateAESKey, 
  encryptAESKeyWithRSA, 
  encryptMessageWithAES 
} from '../../utils/crypto';
import { API_BASE_URL } from '../../constants/Config';

// Polyfills for SockJS in React Native
if (!global.location) {
  global.location = { protocol: 'https:' } as any;
}

export default function ChatScreen() {
  const { id: friendId } = useLocalSearchParams();
  const { user, keys, apiFetch } = useAuth();
  const router = useRouter();
  
  const [friend, setFriend] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const stompClient = useRef<any>(null);

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
      // In a real app, we might have this from the list, but let's fetch for fresh data
      try {
          const res = await apiFetch(`${API_BASE_URL}/api/v1/friends`);
          if (res.ok) {
              const friends = await res.json();
              const f = friends.find((fr: any) => fr.userId === friendId);
              setFriend(f);
          }
      } catch (e) {
          console.error(e);
      }
  };

  const fetchHistory = async () => {
    if (!keys) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/messages/${friendId}`);
      if (res.ok) {
        const history = await res.json();
        const decryptedHistory = history.map((m: any) => {
          let content = "[Encrypted]";
          try {
            const aesKeyToUse = (m.senderId === user?.userId) ? m.senderEncryptedAesKey : m.encryptedAesKey;
            if (aesKeyToUse) {
              const aesKeyStr = decryptAESKeyWithRSA(aesKeyToUse, keys.privateKey);
              const encryptedData = JSON.parse(m.encryptedContent || m.encryptedMessage);
              content = decryptMessageWithAES(encryptedData, aesKeyStr);
            }
          } catch (e) {
            // Silent fail for decryption
          }
          return {
            ...m,
            content,
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

    const socket = new SockJS(`${API_BASE_URL}/ws`);
    const client = Stomp.over(socket);
    client.debug = () => {};

    client.connect({ 'Authorization': 'Bearer ' + user?.accessToken }, () => {
      client.subscribe(`/topic/messages/${user?.userId}`, (msg: any) => {
        const payload = JSON.parse(msg.body);
        if (payload.senderId === friendId) {
          handleIncomingMessage(payload);
        }
      });
    }, (error: any) => {
      console.error('WebSocket error', error);
    });

    stompClient.current = client;
  };

  const handleIncomingMessage = (payload: any) => {
    if (!keys) return;
    let decryptedContent = '🔒 [Decryption failed]';
    try {
      const aesKeyStr = decryptAESKeyWithRSA(payload.encryptedAESKey, keys.privateKey);
      const encryptedData = JSON.parse(payload.encryptedMessage);
      decryptedContent = decryptMessageWithAES(encryptedData, aesKeyStr);
    } catch (error) {
      console.error('Decryption failed', error);
    }

    const newMsg = {
      id: payload.id || Date.now().toString(),
      content: decryptedContent,
      isMe: false,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, newMsg]);
  };

  const sendMessage = async () => {
    if (!inputMsg.trim() || !stompClient.current?.connected || !keys) return;

    try {
      // Get recipient public key
      const pkRes = await apiFetch(`${API_BASE_URL}/api/v1/users/${friendId}/public-key`);
      if (!pkRes.ok) throw new Error('Could not fetch public key');
      const latestPubKey = await pkRes.text();

      const aesKey = generateAESKey();
      const encryptedAESKey = encryptAESKeyWithRSA(aesKey, latestPubKey);
      const senderEncryptedAESKey = encryptAESKeyWithRSA(aesKey, keys.publicKey);
      const encryptedData = encryptMessageWithAES(inputMsg, aesKey);

      const payload = {
        recipientId: friendId,
        encryptedAESKey: encryptedAESKey,
        senderEncryptedAESKey: senderEncryptedAESKey,
        encryptedMessage: JSON.stringify(encryptedData)
      };

      stompClient.current.send("/app/chat.sendMessage", {}, JSON.stringify(payload));

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content: inputMsg,
        isMe: true,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      
      setInputMsg('');
    } catch (error) {
      Alert.alert('Error', 'Failed to send encrypted message');
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
              <Text style={[styles.messageText, item.isMe ? styles.myText : styles.theirText]}>
                {item.content}
              </Text>
            </View>
            <Text style={styles.messageTime}>{item.time}</Text>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />

      <View style={styles.inputArea}>
        <TextInput 
          style={styles.input}
          placeholder="Type an encrypted message..."
          placeholderTextColor="#888"
          value={inputMsg}
          onChangeText={setInputMsg}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Send color="#0b0c10" size={20} />
        </TouchableOpacity>
      </View>
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
    padding: 15,
    paddingBottom: Platform.OS === 'ios' ? 30 : 15,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(11, 12, 16, 0.9)',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(31, 40, 51, 0.5)',
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 10,
    color: '#fff',
    maxHeight: 100,
  },
  sendButton: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: '#66fcf1',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
});
