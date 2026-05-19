import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal, ScrollView, Image } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'expo-router';
import { Users, Bell, LogOut, Cloud, User, UserPlus, Check, Plus, ShieldAlert } from 'lucide-react-native';
import { API_BASE_URL } from '../../constants/Config';
import { useWebSocket } from '../../context/WebSocketContext';
import { Buffer } from 'buffer';
import { generateAESKey, encryptAESKeyWithRSA, deriveKeyFromPassword, encryptDataWithPassword } from '../../utils/crypto';
import forge from 'node-forge';
import * as ImagePicker from 'expo-image-picker';

export default function ChatsScreen() {
  const { user, keys, apiFetch, logout, syncKeysToServer, loading: authLoading, updateProfile, updateAvatar } = useAuth();
  const { unreadCounts, fetchUnreadSummaries } = useWebSocket();
  const router = useRouter();
  
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isUpdatingMetadata, setIsUpdatingMetadata] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileUsername(user.username || "");
      setProfileEmail(user.email || "");
    }
  }, [user]);

  const handlePickAvatar = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Gallery permission is required to update your avatar.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.5,
        allowsEditing: true,
        aspect: [1, 1],
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0].base64) {
        setIsUploadingAvatar(true);
        const base64Img = `data:image/jpeg;base64,${result.assets[0].base64}`;

        const res = await apiFetch(`/api/v1/users/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: base64Img }),
        });

        if (res.ok) {
          await updateAvatar(base64Img);
          Alert.alert('Success', 'Profile picture updated successfully!');
        } else {
          throw new Error(await res.text());
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update avatar.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleUpdateMetadata = async () => {
    if (!profileUsername.trim() || !profileEmail.trim()) {
      Alert.alert("Error", "Username and Email are required.");
      return;
    }
    setIsUpdatingMetadata(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/users/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: profileUsername.trim(), email: profileEmail.trim() }),
      });
      if (res.ok) {
        await updateProfile(profileUsername.trim(), profileEmail.trim());
        Alert.alert("Success", "System credentials updated successfully.");
      } else {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to update profile credentials.");
    } finally {
      setIsUpdatingMetadata(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert("Error", "All authorization password blocks are required.");
      return;
    }
    if (!keys || !user) {
      Alert.alert("Error", "Cryptographic identity not fully loaded or active.");
      return;
    }
    setIsUpdatingPassword(true);
    try {
      const newMasterKey = await deriveKeyFromPassword(newPassword, user.userId);
      const encryptedKeys = encryptDataWithPassword(JSON.stringify(keys), newMasterKey);
      const encryptedKeyBundleStr = JSON.stringify(encryptedKeys);

      const res = await apiFetch(`${API_BASE_URL}/api/v1/users/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          encryptedKeyBundle: encryptedKeyBundleStr
        })
      });

      if (res.ok) {
        Alert.alert(
          "Success",
          "Password matrix and cryptographic bundle rotated securely. You will now be logged out.",
          [{ text: "OK", onPress: () => {
            setShowProfileModal(false);
            setCurrentPassword("");
            setNewPassword("");
            logout();
          }}]
        );
      } else {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      Alert.alert("Authentication Failed", err.message || "Failed to update or rotate secure password.");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Extended 4-way top tab state layout
  const [activeTab, setActiveTab] = useState<'friends' | 'groups' | 'add' | 'requests'>('friends');
  
  // Data Buckets
  const [friends, setFriends] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Native Add Friends Search Sub-Engine States
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // 🚀 FIX: High-performance memoized recency sorting from pre-loaded backend timestamps
  const sortedFriends = useMemo(() => {
    return [...friends].sort((a, b) => (b.lastActiveTimestamp || 0) - (a.lastActiveTimestamp || 0));
  }, [friends]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => (b.lastActiveTimestamp || 0) - (a.lastActiveTimestamp || 0));
  }, [groups]);

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert("Error", "Please enter a group name.");
      return;
    }
    if (selectedFriends.length === 0) {
      Alert.alert("Error", "Please select at least one friend to join.");
      return;
    }
    setIsCreatingGroup(true);
    try {
      // 1. Generate local E2EE symmetric group key
      const groupKey = generateAESKey();
      const groupKey64 = forge.util.encode64(groupKey);

      // 2. Prepare group creation request roster wrapped keys
      const rosterKeys: { [userId: string]: string } = {};

      // 🚀 ASYNC WRAPPER TRAP PROTECTION: Yielding loop for heavy RSA key wrapping
      const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

      // Include self in roster wrapped keys
      const myUserId = user?.userId;
      if (myUserId) {
        const myPublicKeyRes = await apiFetch(`${API_BASE_URL}/api/v1/users/${myUserId}/public-key`);
        if (myPublicKeyRes.ok) {
          const { publicKey } = await myPublicKeyRes.json();
          rosterKeys[myUserId] = encryptAESKeyWithRSA(groupKey64, publicKey);
        }
      }
      await yieldToMainThread();

      for (const friendId of selectedFriends) {
        const pkRes = await apiFetch(`${API_BASE_URL}/api/v1/users/${friendId}/public-key`);
        if (pkRes.ok) {
          const { publicKey } = await pkRes.json();
          rosterKeys[friendId] = encryptAESKeyWithRSA(groupKey64, publicKey);
        }
        await yieldToMainThread(); // Yield event loop to keep the UI fluid!
      }

      // 3. Post E2EE Group payload to server
      const payload = {
        name: newGroupName.trim(),
        rosterKeys
      };

      const res = await apiFetch(`${API_BASE_URL}/api/v1/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text() || "Failed to create group.");
      }

      Alert.alert("Success", `E2EE Group "${newGroupName.trim()}" established!`);
      setNewGroupName("");
      setSelectedFriends([]);
      setShowCreateGroupModal(false);
      fetchAllSocialData();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to establish group.");
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const toggleSelectFriend = (friendId: string) => {
    setSelectedFriends(prev => 
      prev.includes(friendId) ? prev.filter(id => id !== friendId) : [...prev, friendId]
    );
  };

  const CreateGroupModalUI = () => (
    <Modal
      visible={showCreateGroupModal}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowCreateGroupModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.pickerContainer, { maxHeight: '80%', padding: 20 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' }}>
            <Text style={styles.modalTitle}>Establish E2EE Group</Text>
            <TouchableOpacity onPress={() => setShowCreateGroupModal(false)}>
              <Text style={{ color: '#66fcf1', fontWeight: 'bold' }}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.modalInput}
            placeholder="Enter Group Name..."
            placeholderTextColor="#888"
            value={newGroupName}
            onChangeText={setNewGroupName}
          />

          <Text style={{ color: '#45a29e', fontSize: 14, fontWeight: 'bold', marginVertical: 10, alignSelf: 'flex-start' }}>Select Friends to Invite</Text>
          
          <ScrollView style={{ width: '100%', marginBottom: 20 }}>
            {friends.map((item: any) => {
              const isSelected = selectedFriends.includes(item.userId);
              return (
                <TouchableOpacity 
                  key={String(item.userId || Math.random())} 
                  style={[styles.friendItem, isSelected && styles.selectedFriendItem]}
                  onPress={() => toggleSelectFriend(item.userId)}
                >
                  <View style={[styles.avatar, { backgroundColor: '#45a29e' }]}>
                    <Text style={styles.avatarText}>{item.username?.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={{ color: '#fff', fontWeight: 'bold', flex: 1 }}>{item.username}</Text>
                  <View style={[styles.checkbox, isSelected && styles.checkedCheckbox]} />
                </TouchableOpacity>
              );
            })}
            {friends.length === 0 && (
              <Text style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: 10 }}>You must add friends first.</Text>
            )}
          </ScrollView>

          <TouchableOpacity 
            style={styles.modalButton} 
            onPress={handleCreateGroup}
            disabled={isCreatingGroup}
          >
            {isCreatingGroup ? (
              <ActivityIndicator color="#0b0c10" />
            ) : (
              <Text style={{ color: '#0b0c10', fontWeight: 'bold', fontSize: 16 }}>Create Secure Room</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const ProfileModalUI = () => (
    <Modal
      visible={showProfileModal}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowProfileModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.pickerContainer, { maxHeight: '90%', padding: 20 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' }}>
            <Text style={styles.modalTitle}>Personal Profile</Text>
            <TouchableOpacity onPress={() => setShowProfileModal(false)}>
              <Text style={{ color: '#66fcf1', fontWeight: 'bold' }}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center' }} showsVerticalScrollIndicator={false}>
            {/* Avatar Section */}
            <TouchableOpacity onPress={handlePickAvatar} disabled={isUploadingAvatar} style={{ marginBottom: 20, alignItems: 'center' }}>
              {isUploadingAvatar ? (
                <ActivityIndicator size="large" color="#66fcf1" style={{ marginVertical: 30 }} />
              ) : user?.avatar ? (
                <Image source={{ uri: user.avatar }} style={{ width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#66fcf1' }} />
              ) : (
                <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#45a29e', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#66fcf1' }}>
                  <Text style={{ fontSize: 40, fontWeight: 'bold', color: '#0b0c10' }}>
                    {user?.username?.charAt(0)?.toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={{ color: '#66fcf1', fontSize: 12, marginTop: 8, fontWeight: 'bold' }}>Tap to Change Avatar</Text>
            </TouchableOpacity>

            {/* Core Metadata Form */}
            <Text style={{ color: '#45a29e', fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', alignSelf: 'flex-start', marginBottom: 8 }}>Global Profile Credentials</Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="Username"
              placeholderTextColor="#888"
              value={profileUsername}
              onChangeText={setProfileUsername}
              autoCapitalize="none"
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Email Address"
              placeholderTextColor="#888"
              value={profileEmail}
              onChangeText={setProfileEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TouchableOpacity 
              style={[styles.modalButton, { marginBottom: 25 }]} 
              onPress={handleUpdateMetadata}
              disabled={isUpdatingMetadata}
            >
              {isUpdatingMetadata ? (
                <ActivityIndicator color="#0b0c10" />
              ) : (
                <Text style={{ color: '#0b0c10', fontWeight: 'bold', fontSize: 15 }}>Update Core Metadata</Text>
              )}
            </TouchableOpacity>

            {/* Security Credential Rotation Form */}
            <Text style={{ color: '#ff6b6b', fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', alignSelf: 'flex-start', marginBottom: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 15, width: '100%' }}>Rotate Security Credentials</Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="Current Secure Password"
              placeholderTextColor="#888"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            <TextInput
              style={styles.modalInput}
              placeholder="New Secure Password"
              placeholderTextColor="#888"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            <TouchableOpacity 
              style={[styles.modalButton, { backgroundColor: '#ff6b6b' }]} 
              onPress={handleUpdatePassword}
              disabled={isUpdatingPassword}
            >
              {isUpdatingPassword ? (
                <ActivityIndicator color="#0b0c10" />
              ) : (
                <Text style={{ color: '#0b0c10', fontWeight: 'bold', fontSize: 15 }}>Rotate Key Matrix</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );


  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    fetchAllSocialData();
  }, [user, authLoading]);

  const fetchAllSocialData = async () => {
    try {
      const [friendsRes, groupsRes, requestsRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/api/v1/friends`),
        apiFetch(`${API_BASE_URL}/api/v1/groups/my-groups`),
        apiFetch(`${API_BASE_URL}/api/v1/friends/requests`),
        fetchUnreadSummaries()
      ]);

      if (friendsRes.ok) setFriends(await friendsRes.json());
      if (groupsRes.ok) setGroups(await groupsRes.json());
      if (requestsRes.ok) setRequests(await requestsRes.json());
    } catch (e) {
      console.error('Dashboard aggregation crash:', e);
    } finally {
      setLoading(false);
    }
  };

  // 🚀 Live Search Routine for Add Friends Tab
  const handleSearchUsers = async (query: string) => {
    setSearchUsername(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      setIsSearching(true);
      const res = await apiFetch(`${API_BASE_URL}/api/v1/users/search?query=${query}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const sendFriendRequest = async (targetName: string) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/friends/request/${targetName}`, {
        method: 'POST'
      });
      if (res.ok) {
        Alert.alert('Success', `Friend request sent to ${targetName}!`);
        setSearchUsername('');
        setSearchResults([]);
        fetchAllSocialData();
      } else {
        const errMsg = await res.text();
        Alert.alert('Notice', errMsg || 'Failed to send request.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error sending friendship authorization envelope.');
    }
  };

  const acceptFriendRequest = async (requestId: string) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/friends/accept/${requestId}`, { method: 'POST' });
      if (res.ok) {
        Alert.alert('Approved', 'Connection added to cryptographic registry!');
        fetchAllSocialData();
      }
    } catch (e) {
      Alert.alert('Error', 'Handshake accept routine failed.');
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    if (activeTab === 'friends') {
      const unreadCount = unreadCounts[item.userId] || 0;
      return (
        <TouchableOpacity style={styles.listItem} onPress={() => router.push(`/chat/${item.userId}?chatType=private`)}>
          <View style={[styles.avatar, { backgroundColor: '#45a29e' }]}>
            <Text style={styles.avatarText}>{item.username?.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{item.username}</Text>
            <Text style={styles.itemSubtext}>{item.email}</Text>
          </View>
          {unreadCount > 0 && (
            <View style={{ backgroundColor: '#ff6b6b', minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    }

    if (activeTab === 'groups') {
      const unreadCount = unreadCounts[item.groupId] || 0;
      return (
        <TouchableOpacity style={styles.listItem} onPress={() => router.push(`/chat/${item.groupId}?chatType=group`)}>
          <View style={[styles.avatar, { backgroundColor: '#00ff88' }]}>
            <Text style={[styles.avatarText, { color: '#0b0c10' }]}>{item.name?.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemSubtext}>{item.memberCount || 0} members</Text>
          </View>
          {unreadCount > 0 && (
            <View style={{ backgroundColor: '#ff6b6b', minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    }

    if (activeTab === 'add') {
      if (item.username === user?.username) return null; // Hide self profile from discovery
      return (
        <View style={styles.listItem}>
          <View style={[styles.avatar, { backgroundColor: '#a855f7' }]}>
            <Text style={styles.avatarText}>{item.username?.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{item.username}</Text>
            <Text style={styles.itemSubtext}>Global Network Node</Text>
          </View>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#66fcf1' }]} onPress={() => sendFriendRequest(item.username)}>
            <UserPlus color="#0b0c10" size={16} />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.listItem}>
        <View style={[styles.avatar, { backgroundColor: '#66fcf1' }]}>
          <Text style={styles.avatarText}>{item.username?.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName}>{item.username}</Text>
          <Text style={styles.itemSubtext}>Pending authorization link</Text>
        </View>
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#00ff88' }]} onPress={() => acceptFriendRequest(item.id)}>
          <Check color="#0b0c10" size={16} />
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#66fcf1" />
      </View>
    );
  }

  // Check dynamic role from JWT claim
  let isAdmin = false;
  if (user?.accessToken) {
    try {
      const parts = user.accessToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('binary'));
        const tokenRole = payload.role || payload.roles || (payload.authorities ? payload.authorities[0] : null);
        if (tokenRole === 'ROLE_ADMIN' || tokenRole === 'ADMIN') {
          isAdmin = true;
        }
      }
    } catch (e) {
      console.warn("Failed to decode token role claims:", e);
    }
  }

  return (
    <View style={styles.container}>
      {/* Main Header bar */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={() => setShowProfileModal(true)} disabled={isUploadingAvatar}>
            {isUploadingAvatar ? (
              <ActivityIndicator size="small" color="#66fcf1" />
            ) : user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatar, { backgroundColor: '#45a29e', justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={styles.headerAvatarText}>
                  {user?.username?.charAt(0)?.toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Prama Chats</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 15, alignItems: 'center' }}>
          {isAdmin && (
            <TouchableOpacity onPress={() => router.push('/admin/telemetry' as any)}>
              <ShieldAlert color="#ff6b6b" size={24} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={async () => {
            try {
              await syncKeysToServer();
              Alert.alert('Success', 'Keys synced to cloud vault space!');
            } catch (e) {
              Alert.alert('Error', 'Cloud backup rejected.');
            }
          }}>
            <Cloud color="#66fcf1" size={24} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout}>
            <LogOut color="#ff6b6b" size={24} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 🚀 UPGRADED 4-BUTTON TOP TAB ROW DESIGN BAR */}
      <View style={styles.tabRowContainer}>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'friends' && styles.activeTabButton]} onPress={() => setActiveTab('friends')}>
          <User size={14} color={activeTab === 'friends' ? '#0b0c10' : '#45a29e'} />
          <Text style={[styles.tabButtonText, activeTab === 'friends' && styles.activeTabButtonText]} numberOfLines={1}>Friends</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabButton, activeTab === 'groups' && styles.activeTabButton]} onPress={() => setActiveTab('groups')}>
          <Users size={14} color={activeTab === 'groups' ? '#0b0c10' : '#45a29e'} />
          <Text style={[styles.tabButtonText, activeTab === 'groups' && styles.activeTabButtonText]} numberOfLines={1}>Groups</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabButton, activeTab === 'add' && styles.activeTabButton]} onPress={() => { setActiveTab('add'); setSearchResults([]); setSearchUsername(''); }}>
          <UserPlus size={14} color={activeTab === 'add' ? '#0b0c10' : '#45a29e'} />
          <Text style={[styles.tabButtonText, activeTab === 'add' && styles.activeTabButtonText]} numberOfLines={1}>Add</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabButton, activeTab === 'requests' && styles.activeTabButton]} onPress={() => setActiveTab('requests')}>
          <Bell size={14} color={activeTab === 'requests' ? '#0b0c10' : '#45a29e'} />
          <Text style={[styles.tabButtonText, activeTab === 'requests' && styles.activeTabButtonText]} numberOfLines={1}>
            Requests {requests.length > 0 && `(${requests.length})`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Inline Search component injected directly into list head if ADD is active */}
      {activeTab === 'add' && (
        <View style={styles.searchContainer}>
          <TextInput 
            style={styles.searchInput}
            placeholder="Search node identifier by username..."
            placeholderTextColor="#888"
            value={searchUsername}
            onChangeText={handleSearchUsers}
            autoCapitalize="none"
          />
          {isSearching && <ActivityIndicator size="small" color="#66fcf1" style={{ marginLeft: 10 }} />}
        </View>
      )}

      {/* Main Context viewport */}
      <FlatList 
        data={activeTab === 'add' ? searchResults : (activeTab === 'friends' ? sortedFriends : (activeTab === 'groups' ? sortedGroups : requests))}
        keyExtractor={(item) => String(item.userId || item.groupId || item.id || Math.random())}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={fetchAllSocialData}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Users color="#45a29e" size={64} opacity={0.3} />
            <Text style={styles.emptyText}>
              {activeTab === 'friends' && 'No connections active inside this mesh namespace.'}
              {activeTab === 'groups' && 'No verified secure conference rooms available.'}
              {activeTab === 'add' && searchUsername.length > 0 ? 'No matching database records found.' : activeTab === 'add' ? 'Type an identifier above to probe directory layers.' : 'Clean slate! No pending incoming links.'}
            </Text>
          </View>
        }
      />

      {activeTab === 'groups' && (
        <TouchableOpacity 
          style={styles.fab} 
          onPress={() => setShowCreateGroupModal(true)}
        >
          <Plus color="#0b0c10" size={24} />
        </TouchableOpacity>
      )}

      <CreateGroupModalUI />
      <ProfileModalUI />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0c10' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#66fcf1' },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  headerAvatarText: { fontSize: 16, fontWeight: 'bold', color: '#0b0c10' },
  tabRowContainer: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 12, gap: 5, backgroundColor: 'rgba(0,0,0,0.2)' },
  tabButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(31, 40, 51, 0.3)', borderWidth: 1, borderColor: 'rgba(102, 252, 241, 0.05)' },
  activeTabButton: { backgroundColor: '#66fcf1', borderColor: '#66fcf1' },
  tabButtonText: { fontSize: 11, fontWeight: '700', color: '#45a29e' },
  activeTabButtonText: { color: '#0b0c10' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(31, 40, 51, 0.4)', margin: 15, paddingHorizontal: 15, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(102, 252, 241, 0.1)' },
  searchInput: { flex: 1, height: 44, color: '#fff', fontSize: 14 },
  listContent: { padding: 15, paddingTop: 5 },
  listItem: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: 'rgba(31, 40, 51, 0.4)', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(102, 252, 241, 0.05)' },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  avatarText: { fontSize: 18, fontWeight: 'bold', color: '#0b0c10' },
  itemInfo: { flex: 1, overflow: 'hidden' },
  itemName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  itemSubtext: { fontSize: 12, color: '#888', marginTop: 2 },
  actionButton: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0c10' },
  emptyState: { alignItems: 'center', marginTop: 80, padding: 20 },
  emptyText: { color: '#888', textAlign: 'center', marginTop: 15, fontSize: 14 },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    backgroundColor: '#66fcf1',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#66fcf1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pickerContainer: {
    backgroundColor: '#1f2833',
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.2)',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#66fcf1',
  },
  modalInput: {
    width: '100%',
    backgroundColor: '#0b0c10',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.1)',
    marginTop: 10,
    marginBottom: 20,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b0c10',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    width: '100%',
  },
  selectedFriendItem: {
    borderColor: '#66fcf1',
    borderWidth: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#45a29e',
  },
  checkedCheckbox: {
    backgroundColor: '#66fcf1',
    borderColor: '#66fcf1',
  },
  modalButton: {
    backgroundColor: '#66fcf1',
    width: '100%',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
});
