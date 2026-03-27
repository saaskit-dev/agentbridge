import { Image } from 'expo-image';
import * as React from 'react';
import { Modal as RNModal, Pressable, Text, useWindowDimensions } from 'react-native';

export function ImagePreviewModal({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { width, height } = useWindowDimensions();

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
        <Image
          source={{ uri }}
          style={{ width: width * 0.95, height: height * 0.8 }}
          contentFit="contain"
        />
        <Pressable
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 54,
            right: 20,
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
      </Pressable>
    </RNModal>
  );
}
