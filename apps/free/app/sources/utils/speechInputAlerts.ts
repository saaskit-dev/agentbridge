import * as Linking from 'expo-linking';
import { Modal } from '@/modal';
import { t } from '@/text';

export function showSpeechPermissionDeniedAlert(options?: { openSettings?: boolean }) {
  const buttons: Array<{ text: string; style?: 'cancel'; onPress?: () => void }> = [
    { text: t('agentInput.speechInput.permissionCancel'), style: 'cancel' },
  ];
  if (options?.openSettings !== false) {
    buttons.push({
      text: t('agentInput.speechInput.permissionOpenSettings'),
      onPress: () => {
        void Linking.openSettings();
      },
    });
  }
  Modal.alert(
    t('agentInput.speechInput.permissionTitle'),
    t(
      options?.openSettings === false
        ? 'agentInput.speechInput.permissionBrowserMessage'
        : 'agentInput.speechInput.permissionMessage'
    ),
    buttons
  );
}

export function showSpeechRecognitionErrorAlert(error: string) {
  Modal.alert(
    t('agentInput.speechInput.errorTitle'),
    t('agentInput.speechInput.errorMessage', { error })
  );
}

export function showSpeechUnsupportedAlert() {
  Modal.alert(
    t('agentInput.speechInput.unsupportedTitle'),
    t('agentInput.speechInput.unsupportedMessage')
  );
}

export function showSpeechLanguageUnavailableAlert(options: { onUseEnglish?: () => void }) {
  const buttons = [
    { text: t('agentInput.speechInput.languageUnavailableCancel'), style: 'cancel' as const },
    {
      text: t('agentInput.speechInput.languageUnavailableOpenSettings'),
      onPress: () => {
        void Linking.openSettings();
      },
    },
  ];

  if (options.onUseEnglish) {
    buttons.push({
      text: t('agentInput.speechInput.languageUnavailableUseEnglish'),
      onPress: options.onUseEnglish,
    });
  }

  Modal.alert(
    t('agentInput.speechInput.languageUnavailableTitle'),
    t('agentInput.speechInput.languageUnavailableMessage'),
    buttons
  );
}
