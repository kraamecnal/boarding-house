import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'manage',
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#64748B',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#DBEAFE',
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="manage"
        options={{
          title: 'Manage',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Boarding house',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ href: null }}
      />
    </Tabs>
  );
}