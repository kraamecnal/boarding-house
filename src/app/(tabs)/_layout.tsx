import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index', // opens on Boarding Houses; remove to open on Manage
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8A94A6',
      }}
    >
      <Tabs.Screen
        name="manage"
        options={{
          title: 'Manage',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Boarding Houses',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="business-outline" size={size} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}