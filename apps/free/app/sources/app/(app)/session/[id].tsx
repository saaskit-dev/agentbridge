import { useRoute } from '@react-navigation/native';
import * as React from 'react';
import { SessionView } from '@/_session/SessionView';

export default React.memo(() => {
  const route = useRoute();
  const sessionId = (route.params! as any).id as string;
  return <SessionView id={sessionId} />;
});
