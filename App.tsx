import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import BrowserScreen from './src/screens/BrowserScreen';
import DownloadsScreen from './src/screens/DownloadsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import TrimScreen from './src/screens/videoEditor/TrimScreen';
import SubtitleEditorScreen from './src/screens/videoEditor/SubtitleEditorScreen';
import ExportScreen from './src/screens/videoEditor/ExportScreen';
import { DownloadProvider } from './src/store/downloadStore';
import { TabProvider } from './src/store/tabStore';
import { SettingsProvider, useSettings } from './src/store/settingsStore';
import { ProjectProvider } from './src/store/projectStore';
import { AdProvider } from './src/store/adStore';
import { AdController } from './src/components/AdController';
import type { RootStackParamList } from './src/types/videoEditor';
import { UpdateReadyBanner } from './src/components/UpdateReadyBanner';
import { checkAndStartFlexibleUpdate } from './src/services/appUpdate';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

function TabIcon({ label }: { label: string }) {
  return <Text style={{ fontSize: 20 }}>{label}</Text>;
}

function MainTabs() {
  const { themeColors } = useSettings();

  return (
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
        name="Projects"
        component={ProjectsScreen}
        options={{
          tabBarLabel: 'Projects',
          tabBarIcon: () => <TabIcon label="🎬" />,
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
  );
}

function UpdateChecker() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    checkAndStartFlexibleUpdate(() => setUpdateReady(true)).catch(() => {});
  }, []);

  return <UpdateReadyBanner visible={updateReady} onDismiss={() => setUpdateReady(false)} />;
}

function AppNavigator() {
  const { resolvedScheme, themeColors } = useSettings();
  const isDark = resolvedScheme === 'dark';

  const navTheme = isDark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: themeColors.background } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: themeColors.background } };

  return (
    <NavigationContainer theme={navTheme}>
      <AdController />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="Trim" component={TrimScreen} />
        <Stack.Screen name="SubtitleEditor" component={SubtitleEditorScreen} />
        <Stack.Screen name="Export" component={ExportScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <SettingsProvider>
        <ProjectProvider>
          <TabProvider>
            <DownloadProvider>
              <AdProvider>
                <UpdateChecker />
                <AppNavigator />
              </AdProvider>
            </DownloadProvider>
          </TabProvider>
        </ProjectProvider>
      </SettingsProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
