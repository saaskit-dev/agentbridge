import { useEffect } from 'react';
import { compareCreatedDesc } from '@/sync/entitySort';
import { createReducer } from '@/sync/reducer/reducer';
import { storage } from '@/sync/storage';
import { Message } from '@/sync/typesMessage';

const DEMO_SESSION_ID = 'demo-messages-session';

export function useDemoMessages(messages: Message[]) {
  useEffect(() => {
    // Create messages map
    const messagesMap: Record<string, Message> = {};
    messages.forEach(msg => {
      messagesMap[msg.id] = msg;
    });

    // Sort messages by createdAt
    const sortedMessages = [...messages].sort(compareCreatedDesc);
    const messageIndexMap: Record<string, number> = {};
    sortedMessages.forEach((message, index) => {
      messageIndexMap[message.id] = index;
    });

    // Write the demo messages to the hardcoded session
    storage.setState(state => ({
      ...state,
      sessionMessages: {
        ...state.sessionMessages,
        [DEMO_SESSION_ID]: {
          messages: sortedMessages,
          messagesMap: messagesMap,
          messageIndexMap,
          reducerState: createReducer(),
          isLoaded: true,
          lastLocalHydratedAt: 0,
          hasOlderMessages: false,
          isLoadingOlder: false,
        },
      },
    }));

    // Cleanup function to remove the demo session
    return () => {
      storage.setState(state => {
        const { [DEMO_SESSION_ID]: _, ...restSessions } = state.sessionMessages;
        return {
          ...state,
          sessionMessages: restSessions,
        };
      });
    };
  }, [messages]);

  return DEMO_SESSION_ID;
}
