import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { SessionFilePreviewPane } from '@/components/SessionFilePreviewPane';
import { decodeSessionFilePathFromRoute } from '@/utils/sessionFilePath';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/session/file');

export default function FileScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const searchParams = useLocalSearchParams();
  const pathParam = searchParams.path;
  const pathString = Array.isArray(pathParam) ? pathParam[0] : pathParam;

  const normalizedBase64 =
    typeof pathString === 'string' && pathString.length > 0
      ? (() => {
          try {
            return decodeURIComponent(pathString);
          } catch {
            return pathString;
          }
        })()
      : '';

  const filePath = normalizedBase64 ? decodeSessionFilePathFromRoute(normalizedBase64) : '';
  if (normalizedBase64 && !filePath) {
    logger.error('Failed to decode file path from route param');
  }

  return <SessionFilePreviewPane sessionId={sessionId} filePath={filePath} />;
}
