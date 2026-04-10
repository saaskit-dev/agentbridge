import { Image } from 'expo-image';
import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Modal as RNModal, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { t } from '@/text';

export function ImagePreviewModal({
  uri,
  onClose,
  onDownload,
}: {
  uri: string;
  onClose: () => void;
  onDownload?: () => void;
}) {
  const { width, height } = useWindowDimensions();

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <RNModal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.9)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pressable onPress={() => undefined}>
          <Image
            source={{ uri }}
            style={{ width: width * 0.95, height: height * 0.8 }}
            contentFit="contain"
          />
        </Pressable>
        <View
          style={{
            position: 'absolute',
            top: 54,
            right: 20,
            flexDirection: 'row',
            gap: 12,
          }}
        >
          {onDownload && (
            <Pressable
              onPress={onDownload}
              accessibilityLabel={t('files.download')}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="download-outline" size={18} color="#fff" />
            </Pressable>
          )}
          <Pressable
            onPress={onClose}
            accessibilityLabel={t('common.cancel')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>✕</Text>
          </Pressable>
        </View>
      </Pressable>
    </RNModal>
  );
}
