import * as React from 'react';
import { AppState } from 'react-native';
import { useLocalSetting } from '@/sync/storage';
import { syncFocusAudio, stopFocusAudio } from '@/audio/focusAudio';
import { syncFocusAudioNativeFromSharedState } from '@/audio/focusAudioNative';
import { mergeFocusAudioWidgetState, syncFocusAudioWidgetState } from '@/widget/focusAudioWidget';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
import { saveLocalSettings } from '@/sync/persistence';
import { storage } from '@/sync/storage';

const logger = new Logger('app/components/FocusAudioController');

export function FocusAudioController() {
  const enabled = useLocalSetting('focusAudioEnabled');
  const sound = useLocalSetting('focusAudioSound');
  const volume = useLocalSetting('focusAudioVolume');
  const lastAudibleVolume = useLocalSetting('focusAudioLastAudibleVolume');
  const mixWithOthers = useLocalSetting('focusAudioMixWithOthers');

  React.useEffect(() => {
    if (volume <= 0.001 || Math.abs(lastAudibleVolume - volume) <= 0.001) {
      return;
    }

    storage.getState().applyLocalSettings({ focusAudioLastAudibleVolume: volume });
  }, [lastAudibleVolume, volume]);

  React.useEffect(() => {
    void syncFocusAudio({ enabled, sound, volume, mixWithOthers }).catch(error => {
      logger.error('Failed to sync focus audio', toError(error));
    });
  }, [enabled, sound, volume, mixWithOthers]);

  React.useEffect(() => {
    syncFocusAudioWidgetState(storage.getState().localSettings);
  }, [enabled, sound, volume, lastAudibleVolume, mixWithOthers]);

  React.useEffect(() => {
    const applySharedWidgetState = () => {
      const current = storage.getState().localSettings;
      const { nextLocalSettings, changed } = mergeFocusAudioWidgetState(current);
      if (!changed) {
        return;
      }

      saveLocalSettings(nextLocalSettings);
      storage.setState(state => ({
        ...state,
        localSettings: nextLocalSettings,
      }));
    };

    void syncFocusAudioNativeFromSharedState().catch(error => {
      logger.error('Failed to sync native focus audio from shared state', toError(error));
    });
    applySharedWidgetState();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void syncFocusAudioNativeFromSharedState().catch(error => {
          logger.error('Failed to refresh native focus audio from shared state', toError(error));
        });
        applySharedWidgetState();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  React.useEffect(() => {
    return () => {
      void stopFocusAudio().catch(error => {
        logger.error('Failed to stop focus audio during cleanup', toError(error));
      });
    };
  }, []);

  return null;
}
