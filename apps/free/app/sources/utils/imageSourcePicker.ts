import { ActionSheetIOS, Platform } from 'react-native';
import { Modal } from '@/modal';
import { t } from '@/text';

export type ImageSourcePickerActions = {
  /** Open the system photo picker (multi-select). */
  pickFromLibrary: () => void | Promise<void>;
  /** Attach the newest library photo without opening the picker (native only). */
  pickLatestFromLibrary: () => void | Promise<void>;
};

/**
 * Image attach button: web opens the library only. Native shows latest photo + full library.
 * Clipboard images: use the text field paste path (web bridge / system paste).
 */
export async function runImageSourcePicker(actions: ImageSourcePickerActions): Promise<void> {
  if (Platform.OS === 'web') {
    await actions.pickFromLibrary();
    return;
  }

  const { pickFromLibrary, pickLatestFromLibrary } = actions;

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [t('common.cancel'), t('session.pickLatestPhoto'), t('session.chooseFromLibrary')],
        cancelButtonIndex: 0,
      },
      buttonIndex => {
        if (buttonIndex === 1) void pickLatestFromLibrary();
        else if (buttonIndex === 2) void pickFromLibrary();
      }
    );
  } else {
    Modal.alert(t('session.addImage'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('session.pickLatestPhoto'), onPress: () => void pickLatestFromLibrary() },
      { text: t('session.chooseFromLibrary'), onPress: () => void pickFromLibrary() },
    ]);
  }
}
