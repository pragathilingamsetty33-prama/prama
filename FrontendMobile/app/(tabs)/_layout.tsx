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
        tabBarStyle: {
          backgroundColor: '#0b0c10',
          borderTopColor: 'rgba(102, 252, 241, 0.1)',
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
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Add Friends',
          tabBarIcon: ({ color }) => <UserPlus size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
