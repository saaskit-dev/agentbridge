import { useCallback, useRef, useState } from 'react';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { storage } from '@/sync/storage';
import type { SpeechInputHook } from './useSpeechInput';

const logger = new Logger('app/hooks/useSpeechInput.web');

export function useSpeechInput(onTextChange: (text: string) => void): SpeechInputHook {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef('');

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(
    async (baseText: string) => {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        logger.error('SpeechRecognition not supported in this browser');
        return;
      }

      baseTextRef.current = baseText;
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang =
        storage.getState().settings.preferredLanguage || navigator.language || 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (!transcript) return;
        const base = baseTextRef.current;
        onTextChange(base + (base ? ' ' : '') + transcript);
      };

      recognition.onerror = (event: any) => {
        logger.error('Speech recognition error', { error: event.error });
        setIsListening(false);
      };

      recognition.start();
    },
    [onTextChange]
  );

  const cancel = useCallback(() => {
    recognitionRef.current?.abort();
    onTextChange(baseTextRef.current);
  }, [onTextChange]);

  return { isListening, start, stop, cancel };
}
