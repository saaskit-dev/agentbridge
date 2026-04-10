import { Platform } from 'react-native';
import { Modal } from '@/modal';
import { t } from '@/text';

export type ImageSourcePickerActions = {
  /** Open the system photo picker (multi-select). */
  pickFromLibrary: () => void | Promise<void>;
  /** Attach the newest library photo without opening the picker (native only). */
  pickLatestFromLibrary: () => void | Promise<void>;
};

/**
 * Image attach button: always shows a consistent action sheet.
 * Platform-specific capabilities still determine which actions are available.
 */
export async function runImageSourcePicker(actions: ImageSourcePickerActions): Promise<void> {
  const { pickFromLibrary, pickLatestFromLibrary } = actions;
  Modal.alert(t('session.addImage'), undefined, [
    { text: t('common.cancel'), style: 'cancel' },
    ...(Platform.OS === 'web'
      ? []
      : [{ text: t('session.pickLatestPhoto'), onPress: () => void pickLatestFromLibrary() }]),
    { text: t('session.chooseFromLibrary'), onPress: () => void pickFromLibrary() },
  ]);
}
