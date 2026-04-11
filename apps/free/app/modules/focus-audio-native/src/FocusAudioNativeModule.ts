type FocusAudioNativeModuleType = {
  sync(config: {
    enabled: boolean;
    soundUri: string;
    volume: number;
    mixWithOthers: boolean;
  }): Promise<void>;
  stop(): Promise<void>;
  syncFromSharedState(): Promise<boolean>;
};

const nativeModule = ((globalThis as typeof globalThis & {
  expo?: { modules?: Record<string, unknown> };
}).expo?.modules?.FocusAudioNative ?? null) as FocusAudioNativeModuleType | null;

export default nativeModule;
