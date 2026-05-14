import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { UserPlus, Search, Check } from 'lucide-react-native';
import { API_BASE_URL } from '../../constants/Config';

export default function ExploreScreen() {
  const { apiFetch, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/users/search?query=${searchQuery}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const sendRequest = async (username: string) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/friends/request/${username}`, {
        method: 'POST'
      });
      if (res.ok) {
        Alert.alert('Success', `Friend request sent to ${username}`);
      } else {
        const err = await res.text();
        Alert.alert('Error', err || 'Failed to send request');
      }
    } catch (e) {
      Alert.alert('Error', 'Connection failed');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Find Friends</Text>
      </View>

      <View style={styles.searchBox}>
        <TextInput 
          style={styles.searchInput}
          placeholder="Search by username..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Search color="#0b0c10" size={20} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#66fcf1" style={{ marginTop: 20 }} />
      ) : (
        <FlatList 
          data={results}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.userCard}>
              <View style={styles.userInfo}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.username.charAt(0).toUpperCase()}</Text>
                </View>
                <View>
                  <Text style={styles.username}>{item.username}</Text>
                  <Text style={styles.email}>{item.email}</Text>
                </View>
              </View>
              {item.username !== user?.username && (
                <TouchableOpacity 
                  style={styles.addButton}
                  onPress={() => sendRequest(item.username)}
                >
                  <UserPlus color="#0b0c10" size={18} />
                </TouchableOpacity>
              )}
            </View>
          )}
          ListEmptyComponent={
            searchQuery.length > 0 ? (
              <Text style={styles.emptyText}>No users found</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0c10',
  },
  header: {
    padding: 20,
    paddingTop: 60,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#66fcf1',
  },
  searchBox: {
    flexDirection: 'row',
    padding: 20,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'rgba(31, 40, 51, 0.8)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.2)',
  },
  searchButton: {
    backgroundColor: '#66fcf1',
    width: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: 20,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(31, 40, 51, 0.4)',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#45a29e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#0b0c10',
    fontWeight: 'bold',
  },
  username: {
    color: '#fff',
    fontWeight: 'bold',
  },
  email: {
    color: '#888',
    fontSize: 12,
  },
  addButton: {
    backgroundColor: '#66fcf1',
    padding: 8,
    borderRadius: 8,
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
    marginTop: 20,
  }
});
