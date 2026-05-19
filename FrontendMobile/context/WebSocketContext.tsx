import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Client } from '@stomp/stompjs';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { API_BASE_URL } from '../constants/Config';
import { clearGlobalAttachmentCache } from '../utils/AttachmentCache';

interface WebSocketContextType {
  stompClient: Client | null;
  isConnected: boolean;
  unreadCounts: { [chatId: string]: number };
  setUnreadCounts: React.Dispatch<React.SetStateAction<{ [chatId: string]: number }>>;
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  fetchUnreadSummaries: () => Promise<void>;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, apiFetch, getOrRefreshToken, logout } = useAuth();
  const { showToast } = useToast();
  
  const stompClientRef = useRef<Client | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<{ [chatId: string]: number }>({});
  const [activeChatId, setActiveChatIdState] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const deactivateTimeoutRef = useRef<any>(null);

  const setActiveChatId = (id: string | null) => {
    setActiveChatIdState(id);
    activeChatIdRef.current = id;
    if (id) {
      // Clear unread counts for this chat instantly when entering it
      setUnreadCounts(prev => ({ ...prev, [id]: 0 }));
    }
  };

  const fetchUnreadSummaries = async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/messages/unread-summaries`);
      if (res.ok) {
        const summaries = await res.json();
        // Expected format: map of friendId/groupId to count, e.g. { "friend_1": 2, "group_2": 0 }
        setUnreadCounts(summaries || {});
      }
    } catch (err) {
      console.warn("Failed to fetch unread summaries:", err);
    }
  };

  useEffect(() => {
    if (!user) {
      // If user logs out, deactivate client and reset state
      if (stompClientRef.current) {
        stompClientRef.current.deactivate();
        stompClientRef.current = null;
      }
      setIsConnected(false);
      setUnreadCounts({});
      return;
    }

    // Seed initial unread summaries from REST backend
    fetchUnreadSummaries();

    const wsUrl = `${API_BASE_URL}/ws`.replace('http://', 'ws://').replace('https://', 'wss://');
    console.log('📡 [WebSocket] Initializing global STOMP client...');

    const client = new Client({
      brokerURL: wsUrl,
      reconnectDelay: 5000,
      webSocketFactory: () => new WebSocket(wsUrl),
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      connectHeaders: {
        'Authorization': 'Bearer ' + user.accessToken,
      },
    });

    client.debug = (str) => {
      console.log('⚡ [WebSocket RAW Log]:', str);
    };

    client.beforeConnect = async () => {
      try {
        console.log("🔒 [WebSocket Auth] Global proactive token-refresh guard...");
        const freshToken = await getOrRefreshToken();
        if (freshToken) {
          client.connectHeaders = {
            'Authorization': 'Bearer ' + freshToken
          };
          console.log("🔒 [WebSocket Auth] Global connectHeaders refreshed.");
        }
      } catch (error) {
        console.error("🔒 [WebSocket Auth] Failed to refresh token before handshake:", error);
      }
    };

    client.onConnect = (frame) => {
      console.log('🔌 [WebSocket] Global socket connected successfully.');
      setIsConnected(true);

      // Subscribe to global personal queue for real-time messages & updates
      const personalTopic = `/topic/messages.${user.userId}`;
      client.subscribe(personalTopic, (msg: any) => {
        try {
          const payload = JSON.parse(msg.body);
          
          if (payload.type === 'SESSION_EVICTED' || payload.type === 'FORCE_LOGOUT') {
            console.warn("🚨 [Security Eviction] Received eviction payload from administrative server!");
            
            // Clear E2EE attachment memory cache instantly
            clearGlobalAttachmentCache();
            
            // Trigger local credentials purge & navigation stack bounce
            logout();
            
            Alert.alert(
              "Session Revoked", 
              payload.type === 'FORCE_LOGOUT' 
                ? "Core credentials rotated. For your security, this active session has been globally evicted."
                : "This device's secure credentials and active session have been revoked by network administration.",
              [{ text: "OK" }]
            );
            return;
          }

          // Drop non-messages or updates
          if (payload.type === 'MESSAGE_REVOKED' || payload.type === 'MESSAGE_EDITED' || payload.type === 'RECEIPT_UPDATE') {
            return;
          }

          const senderId = String(payload.senderId || payload.sender_id);
          const incomingGroupId = String(payload.groupId || payload.group_id || "");
          const activeSourceId = incomingGroupId || senderId;

          // If the chat is open, yield reception entirely to the chat screen
          if (activeChatIdRef.current === activeSourceId) {
            return;
          }

          // Trigger dynamic local toast notification & increment unread counts locally
          const senderName = payload.senderName || payload.username || "Prama User";
          const messageText = payload.encryptedContent || payload.encryptedMessage ? "🔒 Encrypted Message" : (payload.content || "New message received");
          
          showToast(`Message from ${senderName}`, messageText, activeSourceId);

          setUnreadCounts(prev => ({
            ...prev,
            [activeSourceId]: (prev[activeSourceId] || 0) + 1
          }));
        } catch (e) {
          console.warn("Global message subscription handler error:", e);
        }
      });
    };

    client.onStompError = (frame) => {
      console.error('❌ [WebSocket] Global STOMP protocol error:', frame.headers['message']);
    };

    client.onWebSocketClose = () => {
      console.warn('🔌 [WebSocket] Global socket connection closed.');
      setIsConnected(false);
    };

    stompClientRef.current = client;

    // AppState lifecycle listener to prevent battery drain and native freezes
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('☀️ [AppState] App foregrounded. Waking global socket...');
        if (deactivateTimeoutRef.current) {
          clearTimeout(deactivateTimeoutRef.current);
          deactivateTimeoutRef.current = null;
          console.log('☀️ [AppState] Cancelled pending socket deactivation (app foregrounded quickly).');
        }
        NetInfo.fetch().then(state => {
          if (state.isConnected && stompClientRef.current) {
            console.log('🔌 [AppState] Purging zombie socket descriptors for clean resume...');
            stompClientRef.current.deactivate().then(() => {
              console.log('🔌 [AppState] Re-negotiating clean STOMP handshake...');
              stompClientRef.current?.activate();
            }).catch(() => {
              stompClientRef.current?.activate();
            });
          }
        });
      } else if (nextAppState === 'background') {
        console.log('💤 [AppState] App backgrounded. Scheduling socket deactivation in 10s...');
        if (deactivateTimeoutRef.current) {
          clearTimeout(deactivateTimeoutRef.current);
        }
        deactivateTimeoutRef.current = setTimeout(() => {
          console.log('💤 [AppState] Executing scheduled socket deactivation to preserve battery...');
          if (stompClientRef.current) {
            stompClientRef.current.deactivate();
          }
          setIsConnected(false);
          deactivateTimeoutRef.current = null;
        }, 10000);
      }
    };

    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    // Initial activation
    NetInfo.fetch().then(state => {
      if (state.isConnected) {
        client.activate();
      }
    });

    const netInfoUnsub = NetInfo.addEventListener(state => {
      if (state.isConnected && stompClientRef.current) {
        if (!stompClientRef.current.active || !stompClientRef.current.connected) {
          stompClientRef.current.activate();
        }
      } else if (!state.isConnected && stompClientRef.current) {
        if (stompClientRef.current.active) {
          stompClientRef.current.deactivate();
        }
        setIsConnected(false);
      }
    });

    return () => {
      console.log('🧹 [WebSocket] Cleaning up global socket and AppState listeners...');
      appStateSub.remove();
      netInfoUnsub();
      if (deactivateTimeoutRef.current) {
        clearTimeout(deactivateTimeoutRef.current);
      }
      if (stompClientRef.current) {
        stompClientRef.current.deactivate();
      }
    };
  }, [user]);

  return (
    <WebSocketContext.Provider value={{
      stompClient: stompClientRef.current,
      isConnected,
      unreadCounts,
      setUnreadCounts,
      activeChatId,
      setActiveChatId,
      fetchUnreadSummaries
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};
