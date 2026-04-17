import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { storage } from '@/sync/storage';

interface UseDraftOptions {
  autoSaveInterval?: number; // in milliseconds, default 5000
}

export function useDraft(
  sessionId: string | null | undefined,
  value: string,
  onChange: (value: string) => void,
  options: UseDraftOptions = {}
) {
  const { autoSaveInterval = 5000 } = options;
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedValue = useRef<string>('');
  const isFocused = useIsFocused();

  // Save draft to storage
  const saveDraft = useCallback(
    (draft: string) => {
      if (!sessionId) return;

      storage.getState().updateSessionDraft(sessionId, draft);
      lastSavedValue.current = draft;
    },
    [sessionId]
  );

  // Load draft on mount and when focused
  useEffect(() => {
    if (!sessionId || !isFocused) return;

    const session = storage.getState().sessions[sessionId];
    if (session?.draft && !value) {
      onChange(session.draft);
      lastSavedValue.current = session.draft;
    } else if (!session?.draft) {
      // Ensure lastSavedValue is empty if there's no draft
      lastSavedValue.current = '';
    }
  }, [sessionId, isFocused, onChange]);

  // Auto-save with trailing debounce only. Avoid immediate writes while the user is still typing.
  useEffect(() => {
    if (!sessionId) return;

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only save if value has changed
    if (value !== lastSavedValue.current) {
      saveTimeoutRef.current = setTimeout(() => {
        saveDraft(value);
      }, autoSaveInterval);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [value, sessionId, autoSaveInterval, saveDraft]);

  // Persist when leaving the screen so delayed auto-save does not lose the latest draft.
  useEffect(() => {
    if (!sessionId || isFocused) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (value !== lastSavedValue.current) {
      saveDraft(value);
    }
  }, [isFocused, sessionId, value, saveDraft]);

  // Save on app state change (background/inactive)
  useEffect(() => {
    if (!sessionId) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (value !== lastSavedValue.current) {
          saveDraft(value);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [sessionId, value, saveDraft]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (sessionId && value !== lastSavedValue.current) {
        saveDraft(value);
      }
    };
  }, [sessionId, value, saveDraft]);

  // Clear draft (used after message is sent)
  const clearDraft = useCallback(() => {
    if (!sessionId) return;

    storage.getState().updateSessionDraft(sessionId, null);
    lastSavedValue.current = '';
  }, [sessionId]);

  return {
    clearDraft,
  };
}
