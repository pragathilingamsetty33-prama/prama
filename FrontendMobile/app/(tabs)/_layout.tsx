import { Tabs } from 'expo-router';
import React from 'react';
import { MessageSquare, UserPlus, Settings } from 'lucide-react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#66fcf1',
        tabBarInactiveTintColor: '#45a29e',
        // 🚀 FIX: Turn off and completely hide the bottom navigation bar UI layout frame
        tabBarStyle: {
          display: 'none',
        },
        headerShown: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color }) => <MessageSquare size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
