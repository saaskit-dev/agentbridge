import { useIsFocused, useRoute } from '@react-navigation/native';
import * as React from 'react';
import { SessionView } from '@/-session/SessionView';
import { isDesktopPlatform } from '@/utils/platform';

export default React.memo(() => {
  const route = useRoute();
  const isFocused = useIsFocused();
  const sessionId = (route.params! as any).id as string;

  // On desktop, fully unmount inactive session screens so background tabs
  // don't keep chat subscriptions, streaming renders, or list work alive.
  if (isDesktopPlatform() && !isFocused) {
    return null;
  }

  return <SessionView id={sessionId} isFocused={isFocused} />;
});
