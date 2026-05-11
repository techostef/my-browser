import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  url: string;
  onAllow: () => void;
  onDismiss: () => void;
}

export default function PopupBlockedBanner({ url, onAllow, onDismiss }: Props) {
  let display = url;
  try {
    const u = new URL(url);
    display = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    if (display.length > 50) display = display.slice(0, 50) + '…';
  } catch {}

  return (
    <View style={s.container}>
      <View style={s.iconCol}>
        <Text style={s.icon}>🚫</Text>
      </View>
      <View style={s.body}>
        <Text style={s.title}>Popup blocked</Text>
        <Text style={s.url} numberOfLines={1}>{display}</Text>
      </View>
      <TouchableOpacity style={s.allowBtn} onPress={onAllow} activeOpacity={0.7}>
        <Text style={s.allowText}>Allow</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.dismissBtn} onPress={onDismiss} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={s.dismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3A3A3C',
    gap: 10,
    zIndex: 50,
  },
  iconCol: {
    width: 28,
    alignItems: 'center',
  },
  icon: {
    fontSize: 18,
  },
  body: {
    flex: 1,
  },
  title: {
    color: '#FF9500',
    fontSize: 13,
    fontWeight: '600',
  },
  url: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 1,
  },
  allowBtn: {
    backgroundColor: '#4ECDC4',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  allowText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  dismissBtn: {
    padding: 4,
  },
  dismissText: {
    color: '#8E8E93',
    fontSize: 16,
    fontWeight: '600',
  },
});
