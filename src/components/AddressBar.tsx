import React, { useEffect, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSettings } from '../store/settingsStore';

interface Props {
  initialUrl: string;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
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
  isBookmarked,
  onToggleBookmark,
}: Props) {
  const { searchUrl, themeColors: c } = useSettings();
  const displayUrl = initialUrl === 'about:home' ? '' : initialUrl;
  const [text, setText] = useState(displayUrl);

  useEffect(() => {
    setText(initialUrl === 'about:home' ? '' : initialUrl);
  }, [initialUrl]);

  const handleSubmit = () => {
    let url = text.trim();
    if (!url) return;

    if (!/^https?:\/\//i.test(url)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(url)) {
        url = 'https://' + url;
      } else {
        url = searchUrl(url);
      }
    }
    setText(url);
    onNavigate(url);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.addressBar, borderBottomColor: c.border }]}>
      <View style={styles.navButtons}>
        <TouchableOpacity
          onPress={onGoBack}
          disabled={!canGoBack}
          style={[styles.navBtn, { backgroundColor: c.navButton }, !canGoBack && styles.navBtnDisabled]}>
          <Text style={[styles.navBtnText, { color: c.text }]}>{'<'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onGoForward}
          disabled={!canGoForward}
          style={[styles.navBtn, { backgroundColor: c.navButton }, !canGoForward && styles.navBtnDisabled]}>
          <Text style={[styles.navBtnText, { color: c.text }]}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={[styles.input, { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.text }]}
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        placeholder="Enter URL or search..."
        placeholderTextColor={c.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        selectTextOnFocus
      />

      <TouchableOpacity onPress={onReload} style={[styles.navBtn, { backgroundColor: c.navButton }]}>
        {loading ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : (
          <Text style={[styles.navBtnText, { color: c.text }]}>↻</Text>
        )}
      </TouchableOpacity>
      {onToggleBookmark && (
        <TouchableOpacity onPress={onToggleBookmark} style={[styles.navBtn, { backgroundColor: c.navButton }]}>
          <Text style={[styles.navBtnText, { color: isBookmarked ? '#FFD60A' : c.text }]}>
            {isBookmarked ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      )}
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
