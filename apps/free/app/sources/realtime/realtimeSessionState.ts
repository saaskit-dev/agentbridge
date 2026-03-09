import type { VoiceSession } from './types';

let voiceSession: VoiceSession | null = null;
let currentSessionId: string | null = null;
let voiceSessionStarted: boolean = false;

export function getVoiceSession(): VoiceSession | null {
  return voiceSession;
}

export function setVoiceSession(session: VoiceSession | null): void {
  voiceSession = session;
}

export function getCurrentRealtimeSessionId(): string | null {
  return currentSessionId;
}

export function setCurrentSessionId(id: string | null): void {
  currentSessionId = id;
}

export function isVoiceSessionStarted(): boolean {
  return voiceSessionStarted;
}

export function setVoiceSessionStarted(started: boolean): void {
  voiceSessionStarted = started;
}
