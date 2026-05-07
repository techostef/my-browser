import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import BrowserScreen from './src/screens/BrowserScreen';
import DownloadsScreen from './src/screens/DownloadsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { DownloadProvider } from './src/store/downloadStore';
import { TabProvider } from './src/store/tabStore';
import { SettingsProvider } from './src/store/settingsStore';

const Tab = createBottomTabNavigator();

function TabIcon({ label }: { label: string }) {
  return <Text style={{ fontSize: 20 }}>{label}</Text>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
      <TabProvider>
        <DownloadProvider>
          <NavigationContainer>
          <Tab.Navigator
            detachInactiveScreens={false}
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: '#4ECDC4',
              tabBarInactiveTintColor: '#999',
              tabBarStyle: {
                backgroundColor: '#FFF',
                borderTopColor: '#EEE',
              },
              tabBarLabelStyle: {
                fontSize: 12,
                fontWeight: '600',
              },
            }}>
            <Tab.Screen
              name="Browser"
              component={BrowserScreen}
              options={{
                tabBarLabel: 'Browse',
                tabBarIcon: () => <TabIcon label="🌐" />,
              }}
            />
            <Tab.Screen
              name="Downloads"
              component={DownloadsScreen}
              options={{
                tabBarLabel: 'Downloads',
                tabBarIcon: () => <TabIcon label="📥" />,
              }}
            />
            <Tab.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                tabBarLabel: 'Settings',
                tabBarIcon: () => <TabIcon label="⚙️" />,
              }}
            />
          </Tab.Navigator>
          </NavigationContainer>
        </DownloadProvider>
      </TabProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
