import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import BrowserScreen from './src/screens/BrowserScreen';
import DownloadsScreen from './src/screens/DownloadsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { DownloadProvider } from './src/store/downloadStore';
import { TabProvider } from './src/store/tabStore';
import { SettingsProvider, useSettings } from './src/store/settingsStore';

const Tab = createBottomTabNavigator();

function TabIcon({ label }: { label: string }) {
  return <Text style={{ fontSize: 20 }}>{label}</Text>;
}

function AppNavigator() {
  const { resolvedScheme, themeColors } = useSettings();
  const isDark = resolvedScheme === 'dark';

  const navTheme = isDark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: themeColors.background } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: themeColors.background } };

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        detachInactiveScreens={false}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: themeColors.tabBarActive,
          tabBarInactiveTintColor: themeColors.tabBarInactive,
          tabBarStyle: {
            backgroundColor: themeColors.tabBar,
            borderTopColor: themeColors.tabBarBorder,
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
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <TabProvider>
          <DownloadProvider>
            <AppNavigator />
          </DownloadProvider>
        </TabProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
