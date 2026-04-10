import { useCallback, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { getLocales } from 'expo-localization';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { t } from '@/text';
import { useSetting } from '@/sync/storage';
import {
  showSpeechLanguageUnavailableAlert,
  showSpeechPermissionDeniedAlert,
  showSpeechRecognitionErrorAlert,
} from '@/utils/speechInputAlerts';

const logger = new Logger('app/hooks/useSpeechInput');

// iOS SFSpeechRecognizer uses the legacy "language-REGION" two-part format.
// Three-part BCP-47 tags with script subtags (e.g. zh-Hans-CN) are rejected.
// Map app language codes to the correct iOS locale identifiers.

export interface SpeechInputHook {
  isListening: boolean;
  start: (baseText: string) => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

export function useSpeechInput(onTextChange: (text: string) => void): SpeechInputHook {
  const [isListening, setIsListening] = useState(false);
  const baseTextRef = useRef('');
  const preferredLanguage = useSetting('preferredLanguage');

  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent('result', event => {
    const transcript = event.results[0]?.transcript ?? '';
    if (!transcript) return;
    const base = baseTextRef.current;
    onTextChange(base + (base ? ' ' : '') + transcript);
  });

  useSpeechRecognitionEvent('error', event => {
    const errorCode = String(event.error);
    logger.error('Speech recognition error', undefined, { error: errorCode, message: event.message });
    setIsListening(false);
    // Don't alert for expected non-errors
    if (errorCode === 'no-speech' || errorCode === 'aborted') return;
    if (errorCode === 'language-not-supported') {
      showSpeechLanguageUnavailableAlert({
        onUseEnglish: () => {
          ExpoSpeechRecognitionModule.start({
            interimResults: true,
            continuous: false,
            lang: 'en-US',
          });
        },
      });
      return;
    }
    showSpeechRecognitionErrorAlert(errorCode);
  });

  const start = useCallback(
    async (baseText: string) => {
      try {
        const { status } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (status !== 'granted') {
          logger.error('Speech recognition permission denied', undefined, { status });
          showSpeechPermissionDeniedAlert();
          return;
        }
        baseTextRef.current = baseText;
        // Map app SupportedLanguage codes to BCP-47 tags for SFSpeechRecognizer
        // iOS SFSpeechRecognizer requires legacy "language-REGION" format (no script subtag).
        // e.g. "zh-CN" works, "zh-Hans-CN" does not.
        const appLangToBcp47: Record<string, string> = {
          'zh-Hans': 'zh-CN',
          'zh-Hant': 'zh-TW',
          'ja': 'ja-JP',
          'ru': 'ru-RU',
          'es': 'es-ES',
          'pt': 'pt-BR',
          'it': 'it-IT',
          'pl': 'pl-PL',
          'ca': 'ca-ES',
          'en': 'en-US',
        };
        const rawDeviceLang = getLocales()[0]?.languageTag ?? 'en-US';
        // iOS SFSpeechRecognizer only accepts two-part "language-REGION" tags.
        // Three-part BCP-47 tags with script subtags are rejected (e.g. zh-Hans-US → language-not-supported).
        // Chinese must map to zh-CN / zh-TW regardless of device region.
        const normalizeLocale = (tag: string): string => {
          if (tag.startsWith('zh-Hans') || tag.startsWith('cmn-Hans')) return 'zh-CN';
          if (tag.startsWith('zh-Hant') || tag.startsWith('cmn-Hant')) return 'zh-TW';
          // Strip script subtag for other languages: e.g. sr-Latn-RS → sr-RS
          return tag.replace(/^([a-z]{2,3})-[A-Z][a-z]{3}-([A-Z]{2})$/, '$1-$2');
        };
        const deviceLang = normalizeLocale(rawDeviceLang);
        // preferredLanguage null = auto (follow device locale)
        const preferred = preferredLanguage ? (appLangToBcp47[preferredLanguage] ?? deviceLang) : deviceLang;
        logger.debug('Starting speech recognition', { preferredLanguage, preferred, lang: preferred });

        ExpoSpeechRecognitionModule.start({
          interimResults: true,
          continuous: false,
          lang: preferred,
        });
      } catch (e) {
        logger.error('Speech recognition start failed', undefined, { error: String(e) });
        setIsListening(false);
      }
    },
    [preferredLanguage]
  );

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const cancel = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    onTextChange(baseTextRef.current);
  }, [onTextChange]);

  return { isListening, start, stop, cancel };
}
