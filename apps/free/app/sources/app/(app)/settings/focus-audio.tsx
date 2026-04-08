import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as React from 'react';
import { View, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import {
  FOCUS_AUDIO_CATALOG,
  FOCUS_AUDIO_CATEGORIES,
  getFocusAudioSound,
  type FocusAudioSound,
} from '@/audio/focusAudioCatalog';
import { prepareFocusAudioSound, useFocusAudioState } from '@/audio/focusAudio';
import { useLocalSettingMutable } from '@/sync/storage';
import { t } from '@/text';

const stylesheet = StyleSheet.create(theme => ({
  volumeCard: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  volumeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  volumeTitle: {
    ...Typography.default('regular'),
    fontSize: 17,
    color: theme.colors.text,
  },
  volumeValue: {
    ...Typography.default('regular'),
    fontSize: 15,
    color: theme.colors.textSecondary,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  helperText: {
    ...Typography.default('regular'),
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    marginTop: 8,
  },
}));

function getSoundLabel(sound: FocusAudioSound): string {
  switch (sound) {
    case 'white-noise':
      return t('focusAudio.whiteNoise');
    case 'pink-noise':
      return t('focusAudio.pinkNoise');
    case 'brown-noise':
      return t('focusAudio.brownNoise');
    default:
      return getFocusAudioSound(sound).label;
  }
}

export default function FocusAudioSettingsScreen() {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const [enabled, setEnabled] = useLocalSettingMutable('focusAudioEnabled');
  const [sound, setSound] = useLocalSettingMutable('focusAudioSound');
  const [volume, setVolume] = useLocalSettingMutable('focusAudioVolume');
  const [mixWithOthers, setMixWithOthers] = useLocalSettingMutable('focusAudioMixWithOthers');
  const [draftVolume, setDraftVolume] = React.useState(volume);
  const audioState = useFocusAudioState();

  React.useEffect(() => {
    setDraftVolume(volume);
  }, [volume]);

  const volumePercent = Math.round(draftVolume * 100);
  const selectedSoundLoading = audioState.loadingSounds.includes(sound);
  const selectedSoundFailed = audioState.failedSound === sound;

  const handleSelectSound = React.useCallback(
    (nextSound: FocusAudioSound) => {
      setSound(nextSound);
      void prepareFocusAudioSound(nextSound).catch(error => {
        Modal.alert(t('common.error'), String(error));
      });
    },
    [setSound]
  );

  return (
    <ItemList style={{ paddingTop: 0 }}>
      <ItemGroup footer={t('focusAudio.description')}>
        <Item
          title={t('focusAudio.enable')}
          subtitle={enabled ? t('focusAudio.enabledState') : t('focusAudio.disabledState')}
          icon={<Ionicons name="musical-notes-outline" size={29} color="#007AFF" />}
          rightElement={<Switch value={enabled} onValueChange={setEnabled} />}
          showChevron={false}
        />
        <View style={styles.volumeCard}>
          <View style={styles.volumeHeader}>
            <Text style={styles.volumeTitle}>{t('focusAudio.volume')}</Text>
            <Text style={styles.volumeValue}>{t('focusAudio.volumePercent', { percent: volumePercent })}</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={draftVolume}
            minimumTrackTintColor="#007AFF"
            maximumTrackTintColor={theme.colors.divider}
            thumbTintColor={Platform.OS === 'android' ? '#007AFF' : undefined}
            onValueChange={setDraftVolume}
            onSlidingComplete={setVolume}
          />
          <Text style={styles.helperText}>
            {selectedSoundLoading
              ? t('common.loading')
              : selectedSoundFailed
                ? t('common.error')
                : t('focusAudio.volumeHint')}
          </Text>
        </View>
        <Item
          title={t('focusAudio.mixWithOthers')}
          subtitle={t('focusAudio.mixWithOthersSubtitle')}
          icon={<Ionicons name="layers-outline" size={29} color="#5856D6" />}
          rightElement={<Switch value={mixWithOthers} onValueChange={setMixWithOthers} />}
          showChevron={false}
        />
      </ItemGroup>

      {FOCUS_AUDIO_CATEGORIES.map(category => (
        <ItemGroup
          key={category.id}
          title={category.label}
          footer={
            category.id === 'noise'
              ? enabled
                ? t('focusAudio.soundFooter')
                : t('focusAudio.soundFooterDisabled')
              : undefined
          }
        >
          {FOCUS_AUDIO_CATALOG.filter(option => option.category === category.id).map(option => (
            <Item
              key={option.id}
              title={getSoundLabel(option.id)}
              subtitle={sound === option.id ? t('focusAudio.selectedSound') : undefined}
              icon={
                <Ionicons
                  name={sound === option.id ? 'radio-button-on-outline' : 'radio-button-off-outline'}
                  size={29}
                  color={sound === option.id ? '#34C759' : theme.colors.textSecondary}
                />
              }
              loading={audioState.loadingSounds.includes(option.id)}
              onPress={() => handleSelectSound(option.id)}
              showChevron={false}
            />
          ))}
        </ItemGroup>
      ))}
    </ItemList>
  );
}
