import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator, 
  ScrollView, 
  Platform,
  Alert 
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { 
  ArrowLeft,
  ShieldAlert, 
  Activity, 
  Database, 
  Users, 
  Lock,
  ToggleLeft,
  ToggleRight
} from 'lucide-react-native';
import { API_BASE_URL } from '../../constants/Config';
import { Buffer } from 'buffer';

export default function AdminTelemetryScreen() {
  const { apiFetch, user } = useAuth();
  const router = useRouter();
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminGroups, setAdminGroups] = useState<any[]>([]);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

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

  const fetchAdminTelemetry = async () => {
    if (!isAdmin) return;
    setTelemetryLoading(true);
    try {
      const [usersRes, groupsRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/api/v1/admin/users?page=0&size=50`),
        apiFetch(`${API_BASE_URL}/api/v1/admin/groups`)
      ]);

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setAdminUsers(usersData.content || usersData);
      }
      if (groupsRes.ok) {
        setAdminGroups(await groupsRes.json());
      }
    } catch (err) {
      console.warn("Failed to fetch admin telemetry panel data:", err);
    } finally {
      setTelemetryLoading(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentEnabled: boolean) => {
    const isSelf = String(userId) === String(user?.userId);
    if (isSelf) {
      Alert.alert("Action Blocked", "To prevent permanent lockout, you cannot suspend your own administrative session.");
      return;
    }

    setTogglingUserId(userId);

    // 1. Optimistic UI update (swap status immediately)
    setAdminUsers(prev => prev.map(u => {
      const uId = String(u.userId || u.id);
      if (uId === String(userId)) {
        return { ...u, enabled: !currentEnabled };
      }
      return u;
    }));

    try {
      // 2. Dispatch PATCH to database status controller
      const res = await apiFetch(`${API_BASE_URL}/api/v1/admin/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled })
      });

      if (!res.ok) {
        throw new Error("Server rejected status mutation.");
      }

      // 3. Sync clean telemetry registry
      await fetchAdminTelemetry();
    } catch (err) {
      console.error("❌ [Admin Kill Switch Failure]:", err);
      Alert.alert("Execution Error", "Failed to toggle user security status. Rolling back state.");
      
      // 4. Rollback UI state on failure
      setAdminUsers(prev => prev.map(u => {
        const uId = String(u.userId || u.id);
        if (uId === String(userId)) {
          return { ...u, enabled: currentEnabled };
        }
        return u;
      }));
    } finally {
      setTogglingUserId(null);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      Alert.alert("Access Denied", "Administrative privileges required.");
      router.replace('/(tabs)');
      return;
    }
    fetchAdminTelemetry();
  }, [user]);

  if (!isAdmin) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#ff6b6b" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* Custom full-screen dashboard header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color="#66fcf1" size={24} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ShieldAlert color="#ff6b6b" size={22} />
          <Text style={styles.headerTitle}>Control Console</Text>
        </View>
        <TouchableOpacity onPress={fetchAdminTelemetry} disabled={telemetryLoading}>
          {telemetryLoading ? (
            <ActivityIndicator size="small" color="#66fcf1" />
          ) : (
            <Text style={styles.refreshLink}>Sync</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollContainer} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Real-time Telemetry Stats Row */}
        <Text style={styles.sectionTitle}>📡 SYSTEM TELEMETRY</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Activity color="#66fcf1" size={18} />
            <Text style={styles.statValue}>12%</Text>
            <Text style={styles.statLabel}>CPU Load</Text>
          </View>
          <View style={styles.statCard}>
            <Database color="#66fcf1" size={18} />
            <Text style={styles.statValue}>1.4 GB</Text>
            <Text style={styles.statLabel}>Memory</Text>
          </View>
          <View style={styles.statCard}>
            <Users color="#66fcf1" size={18} />
            <Text style={styles.statValue}>{adminUsers.length}</Text>
            <Text style={styles.statLabel}>Active Nodes</Text>
          </View>
        </View>

        {/* Node Registry */}
        <Text style={styles.sectionTitle}>👥 NODE REGISTRY ({adminUsers.length})</Text>
        {telemetryLoading && adminUsers.length === 0 ? (
          <ActivityIndicator color="#66fcf1" style={{ marginVertical: 20 }} />
        ) : (
          adminUsers.map((u: any) => {
            const userId = String(u.userId || u.id);
            const isSelf = String(userId) === String(user?.userId);
            const isToggling = togglingUserId === userId;
            const isEnabled = u.enabled !== false;

            return (
              <View 
                key={String(u.id || u.userId || Math.random())} 
                style={[
                  styles.adminListCard, 
                  !isEnabled && styles.adminListCardDisabled,
                  isToggling && { opacity: 0.7 }
                ]}
              >
                <View style={{ flex: 1, marginRight: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.adminCardTitle}>{u.username}</Text>
                    {isSelf && <Text style={styles.selfLabel}>(You)</Text>}
                  </View>
                  <Text style={styles.adminCardSub}>{u.email}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <View style={[styles.roleBadge, (u.role === 'ROLE_ADMIN' || u.role === 'ADMIN') && styles.roleBadgeAdmin]}>
                      <Text style={[styles.roleText, (u.role === 'ROLE_ADMIN' || u.role === 'ADMIN') && styles.roleTextAdmin]}>
                        {u.role ? u.role.replace('ROLE_', '') : 'USER'}
                      </Text>
                    </View>
                    <View style={[styles.statusIndicator, isEnabled ? styles.statusIndicatorActive : styles.statusIndicatorSuspended]}>
                      <Text style={styles.statusText}>{isEnabled ? 'ACTIVE' : 'SUSPENDED'}</Text>
                    </View>
                  </View>
                </View>

                {/* Kill Switch Toggle Interface */}
                {isToggling ? (
                  <ActivityIndicator size="small" color="#66fcf1" style={{ marginRight: 8 }} />
                ) : (
                  <TouchableOpacity 
                    onPress={() => toggleUserStatus(userId, isEnabled)}
                    disabled={isSelf}
                    style={[styles.toggleButton, isSelf && { opacity: 0.3 }]}
                  >
                    {isEnabled ? (
                      <ToggleRight color="#00ff88" size={36} />
                    ) : (
                      <ToggleLeft color="#ff6b6b" size={36} />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}

        {/* E2EE Channel Registry */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>🔒 SECURE GROUPS ({adminGroups.length})</Text>
        {telemetryLoading && adminGroups.length === 0 ? (
          <ActivityIndicator color="#66fcf1" style={{ marginVertical: 20 }} />
        ) : (
          adminGroups.map((g: any) => (
            <View key={String(g.groupId || g.id || Math.random())} style={styles.adminListCard}>
              <View>
                <Text style={styles.adminCardTitle}>{g.name}</Text>
                <Text style={styles.adminCardSub}>ID: {g.groupId}</Text>
              </View>
              <View style={styles.memberBadge}>
                <Text style={styles.memberText}>{g.memberCount || 0} Members</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
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
    paddingHorizontal: 20,
    paddingBottom: 15,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(102, 252, 241, 0.1)',
    backgroundColor: '#0b0c10',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  refreshLink: {
    color: '#66fcf1',
    fontSize: 14,
    fontWeight: 'bold',
  },
  scrollContainer: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    color: '#45a29e',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 12,
    marginTop: 10,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1f2833',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.05)',
  },
  statValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 6,
  },
  statLabel: {
    color: '#888',
    fontSize: 10,
    marginTop: 2,
  },
  adminListCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 40, 51, 0.4)',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.02)',
  },
  adminListCardDisabled: {
    borderColor: 'rgba(255, 107, 107, 0.1)',
    backgroundColor: 'rgba(255, 107, 107, 0.02)',
  },
  adminCardTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  selfLabel: {
    color: '#66fcf1',
    fontSize: 11,
    fontWeight: 'bold',
  },
  adminCardSub: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  roleBadge: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeAdmin: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderWidth: 0.5,
    borderColor: '#ff6b6b',
  },
  roleText: {
    color: '#aaa',
    fontSize: 9,
    fontWeight: 'bold',
  },
  roleTextAdmin: {
    color: '#ff6b6b',
  },
  statusIndicator: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusIndicatorActive: {
    backgroundColor: 'rgba(0, 255, 136, 0.08)',
    borderWidth: 0.5,
    borderColor: '#00ff88',
  },
  statusIndicatorSuspended: {
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    borderWidth: 0.5,
    borderColor: '#ff6b6b',
  },
  statusText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    color: '#fff',
  },
  toggleButton: {
    padding: 2,
  },
  memberBadge: {
    backgroundColor: 'rgba(102, 252, 241, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  memberText: {
    color: '#66fcf1',
    fontSize: 10,
    fontWeight: 'bold',
  }
});
