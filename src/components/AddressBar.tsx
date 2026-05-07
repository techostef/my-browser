import React, { useEffect, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

interface Props {
  initialUrl: string;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  tabTrigger?: React.ReactNode;
}

export default function AddressBar({
  initialUrl,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  canGoBack,
  canGoForward,
  loading,
  tabTrigger,
}: Props) {
  const [text, setText] = useState(initialUrl);

  useEffect(() => {
    setText(initialUrl);
  }, [initialUrl]);

  const handleSubmit = () => {
    let url = text.trim();
    if (!url) return;

    // Auto-add https if no scheme
    if (!/^https?:\/\//i.test(url)) {
      // If it looks like a domain, navigate; otherwise search
      if (/^[\w-]+(\.[\w-]+)+/.test(url)) {
        url = 'https://' + url;
      } else {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }
    }
    setText(url);
    onNavigate(url);
  };

  return (
    <View style={styles.container}>
      <View style={styles.navButtons}>
        <TouchableOpacity
          onPress={onGoBack}
          disabled={!canGoBack}
          style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>{'<'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onGoForward}
          disabled={!canGoForward}
          style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        placeholder="Enter URL or search..."
        placeholderTextColor="#999"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        selectTextOnFocus
      />

      <TouchableOpacity onPress={onReload} style={styles.navBtn}>
        {loading ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : (
          <Text style={styles.navBtnText}>↻</Text>
        )}
      </TouchableOpacity>
      {tabTrigger}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#F8F8F8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCC',
  },
  navButtons: {
    flexDirection: 'row',
    marginRight: 6,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  input: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DDD',
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#333',
    marginHorizontal: 6,
  },
});
