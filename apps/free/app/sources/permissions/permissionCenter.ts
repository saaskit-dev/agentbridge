import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Linking, Platform } from 'react-native';
import { sync } from '@/sync/sync';
import { checkMicrophonePermission, requestMicrophonePermission } from '@/utils/microphonePermissions';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/permissions/permissionCenter');

export type PermissionId =
  | 'notifications'
  | 'microphone'
  | 'speechRecognition'
  | 'photos'
  | 'camera';

export type PermissionState = 'allowed' | 'limited' | 'notAsked' | 'blocked' | 'unavailable';
export type PermissionAction = 'allow' | 'manage' | 'none';
export type PermissionGroup = 'recommended' | 'optional';

export interface PermissionItem {
  id: PermissionId;
  group: PermissionGroup;
  icon: string;
  titleKey: string;
  purposeKey: string;
  minimizeKey: string;
  state: PermissionState;
  action: PermissionAction;
}

function toPermissionState({
  granted,
  canAskAgain,
  limited = false,
}: {
  granted: boolean;
  canAskAgain?: boolean;
  limited?: boolean;
}): PermissionState {
  if (granted && limited) return 'limited';
  if (granted) return 'allowed';
  if (canAskAgain === false) return 'blocked';
  return 'notAsked';
}

function toAction(state: PermissionState): PermissionAction {
  if (state === 'unavailable') return 'none';
  if (state === 'notAsked') return 'allow';
  return 'manage';
}

async function getNotificationsItem(): Promise<PermissionItem> {
  const permissions = await Notifications.getPermissionsAsync();
  const state = toPermissionState({
    granted: permissions.status === 'granted',
    canAskAgain: permissions.canAskAgain,
  });
  return {
    id: 'notifications',
    group: 'recommended',
    icon: 'notifications-outline',
    titleKey: 'permissions.notificationsTitle',
    purposeKey: 'permissions.notificationsPurpose',
    minimizeKey: 'permissions.notificationsMinimize',
    state,
    action: toAction(state),
  };
}

async function getMicrophoneItem(): Promise<PermissionItem> {
  const permissions = await checkMicrophonePermission();
  const state = toPermissionState(permissions);
  return {
    id: 'microphone',
    group: 'recommended',
    icon: 'mic-outline',
    titleKey: 'permissions.microphoneTitle',
    purposeKey: 'permissions.microphonePurpose',
    minimizeKey: 'permissions.microphoneMinimize',
    state,
    action: toAction(state),
  };
}

async function getSpeechRecognitionItem(): Promise<PermissionItem> {
  if (Platform.OS === 'web') {
    const supported =
      typeof window !== 'undefined' &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    return {
      id: 'speechRecognition',
      group: 'recommended',
      icon: 'chatbox-ellipses-outline',
      titleKey: 'permissions.speechTitle',
      purposeKey: 'permissions.speechPurpose',
      minimizeKey: 'permissions.speechMinimize',
      state: supported ? 'notAsked' : 'unavailable',
      action: supported ? 'none' : 'none',
    };
  }

  const permissions = await ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync();
  const state = toPermissionState({
    granted: permissions.granted,
    canAskAgain: permissions.canAskAgain,
  });
  return {
    id: 'speechRecognition',
    group: 'recommended',
    icon: 'chatbox-ellipses-outline',
    titleKey: 'permissions.speechTitle',
    purposeKey: 'permissions.speechPurpose',
    minimizeKey: 'permissions.speechMinimize',
    state,
    action: toAction(state),
  };
}

async function getPhotosItem(): Promise<PermissionItem> {
  const permissions = await ImagePicker.getMediaLibraryPermissionsAsync(false);
  const state = toPermissionState({
    granted: permissions.granted,
    canAskAgain: permissions.canAskAgain,
    limited: permissions.accessPrivileges === 'limited',
  });
  return {
    id: 'photos',
    group: 'optional',
    icon: 'images-outline',
    titleKey: 'permissions.photosTitle',
    purposeKey: 'permissions.photosPurpose',
    minimizeKey: 'permissions.photosMinimize',
    state,
    action: toAction(state),
  };
}

async function getCameraItem(): Promise<PermissionItem> {
  const permissions = await ImagePicker.getCameraPermissionsAsync();
  const state = toPermissionState({
    granted: permissions.granted,
    canAskAgain: permissions.canAskAgain,
  });
  return {
    id: 'camera',
    group: 'optional',
    icon: 'camera-outline',
    titleKey: 'permissions.cameraTitle',
    purposeKey: 'permissions.cameraPurpose',
    minimizeKey: 'permissions.cameraMinimize',
    state,
    action: toAction(state),
  };
}

export async function loadPermissionItems(): Promise<PermissionItem[]> {
  const items: PermissionItem[] = [];
  if (Platform.OS !== 'web') {
    items.push(await getNotificationsItem());
  }
  items.push(await getMicrophoneItem());
  items.push(await getSpeechRecognitionItem());

  items.push(await getPhotosItem());

  if (Platform.OS === 'ios') {
    items.push(await getCameraItem());
  }

  return items;
}

export async function openPermissionSettings(): Promise<void> {
  await Linking.openSettings();
}

export async function performPermissionAction(item: PermissionItem): Promise<void> {
  switch (item.id) {
    case 'notifications': {
      if (item.action === 'allow') {
        const result = await sync.enableBackgroundReconnectNotifications();
        if (result === 'settings-required') {
          await openPermissionSettings();
        }
        return;
      }
      await openPermissionSettings();
      return;
    }
    case 'microphone': {
      if (item.action === 'allow') {
        const result = await requestMicrophonePermission();
        if (!result.granted && result.canAskAgain === false) {
          await openPermissionSettings();
        }
        return;
      }
      await openPermissionSettings();
      return;
    }
    case 'speechRecognition': {
      if (Platform.OS === 'web') {
        return;
      }
      if (item.action === 'allow') {
        const result = await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync();
        if (!result.granted && result.canAskAgain === false) {
          await openPermissionSettings();
        }
        return;
      }
      await openPermissionSettings();
      return;
    }
    case 'photos': {
      if (item.action === 'allow') {
        const result = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
        if (!result.granted && result.canAskAgain === false) {
          await openPermissionSettings();
        }
        return;
      }
      await openPermissionSettings();
      return;
    }
    case 'camera': {
      if (item.action === 'allow') {
        const result = await ImagePicker.requestCameraPermissionsAsync();
        if (!result.granted && result.canAskAgain === false) {
          await openPermissionSettings();
        }
        return;
      }
      await openPermissionSettings();
      return;
    }
    default: {
      logger.warn('[permissions] unknown permission item', { id: item.id });
    }
  }
}
