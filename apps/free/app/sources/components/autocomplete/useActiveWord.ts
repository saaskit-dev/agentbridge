import * as React from 'react';
import { findActiveWord } from './findActiveWord';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/autocomplete/useActiveWord');

export function useActiveWord(
  text: string,
  selection: { start: number; end: number },
  prefixes: string[] = ['@', '/', ':']
) {
  return React.useMemo(() => {
    const w = findActiveWord(text, selection, prefixes);
    // logger.debug('🔎 useActiveWord:', JSON.stringify({
    //     text,
    //     selection,
    //     prefixes,
    //     foundWord: w,
    //     returning: w?.activeWord || null
    // }, null, 2));
    if (w) {
      return w.activeWord;
    }
    return null;
  }, [text, selection.start, selection.end, prefixes]);
}
