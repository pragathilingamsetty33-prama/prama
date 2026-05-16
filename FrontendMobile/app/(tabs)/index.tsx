import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'expo-router';
import { Users, Bell, UserPlus, LogOut, Cloud } from 'lucide-react-native';
import { API_BASE_URL } from '../../constants/Config';

export default function ChatsScreen() {
  const { user, apiFetch, logout, syncKeysToServer, loading: authLoading } = useAuth();
  const router = useRouter();
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Wait for auth to finish loading before deciding what to do
    if (authLoading) return;

    if (!user) {
      // Not logged in — go to login immediately
      router.replace('/login');
      return;
    }
    // Logged in — fetch friends
    fetchFriends();
  }, [user, authLoading]);

  const fetchFriends = async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/friends`);
      if (res.ok) {
        const data = await res.json();
        setFriends(data);
      }
    } catch (e) {
      console.error('Failed to fetch friends', e);
    } finally {
      setLoading(false);
    }
  };

  const renderFriendItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={styles.friendItem}
      onPress={() => router.push(`/chat/${item.userId}`)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.username.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{item.username}</Text>
        <Text style={styles.friendEmail}>{item.email}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#66fcf1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Prama Chats</Text>
        <View style={{ flexDirection: 'row', gap: 15, alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={async () => {
              try {
                await syncKeysToServer();
                Alert.alert('Success', 'Keys synced to cloud! You can now log in on other devices.');
              } catch (e) {
                Alert.alert('Error', 'Sync failed. Please check your connection.');
              }
            }}
          >
            <Cloud color="#66fcf1" size={24} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout}>
            <LogOut color="#ff6b6b" size={24} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList 
        data={friends}
        keyExtractor={(item) => item.userId}
        renderItem={renderFriendItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Users color="#45a29e" size={64} opacity={0.3} />
            <Text style={styles.emptyText}>No friends yet. Add someone to start chatting!</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0c10',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#66fcf1',
  },
  listContent: {
    padding: 10,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: 'rgba(31, 40, 51, 0.4)',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.05)',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#45a29e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0b0c10',
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  friendEmail: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0b0c10',
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 100,
    padding: 20,
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
  },
});
