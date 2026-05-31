import { useCallback, useMemo } from 'react';
import { useSettings, LANGUAGE_CODES } from '../store/settingsStore';
import { translationsByCode, type TranslationKey } from './translations';

/**
 * Returns a `t()` function that resolves a translation key to the
 * user's currently selected language.
 *
 * Supports simple interpolation via `{key}` placeholders:
 *   t('searchOrType', { engine: 'Google' })  →  "Search Google or type a URL"
 */
export function useTranslation() {
  const { settings } = useSettings();
  const langCode = LANGUAGE_CODES[settings.language] || 'en';
  const strings = useMemo(
    () => translationsByCode[langCode] || translationsByCode.en,
    [langCode],
  );

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      let text = strings[key] ?? translationsByCode.en[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return text;
    },
    [strings],
  );

  return { t };
}
