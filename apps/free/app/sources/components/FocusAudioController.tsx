import * as React from 'react';
import { useLocalSetting } from '@/sync/storage';
import { syncFocusAudio, stopFocusAudio } from '@/audio/focusAudio';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/components/FocusAudioController');

export function FocusAudioController() {
  const enabled = useLocalSetting('focusAudioEnabled');
  const sound = useLocalSetting('focusAudioSound');
  const volume = useLocalSetting('focusAudioVolume');
  const mixWithOthers = useLocalSetting('focusAudioMixWithOthers');

  React.useEffect(() => {
    void syncFocusAudio({ enabled, sound, volume, mixWithOthers }).catch(error => {
      logger.error('Failed to sync focus audio', toError(error));
    });
  }, [enabled, sound, volume, mixWithOthers]);

  React.useEffect(() => {
    return () => {
      void stopFocusAudio().catch(error => {
        logger.error('Failed to stop focus audio during cleanup', toError(error));
      });
    };
  }, []);

  return null;
}
