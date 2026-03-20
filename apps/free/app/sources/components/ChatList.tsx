import * as React from 'react';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatFooter } from './ChatFooter';
import { MessageView } from './MessageView';
import { useSession, useSessionMessages } from '@/sync/storage';
import { Metadata, Session } from '@/sync/storageTypes';
import { Message } from '@/sync/typesMessage';
import { sync } from '@/sync/sync';
import { useHeaderHeight } from '@/utils/responsive';

export const ChatList = React.memo((props: { session: Session; footerNotice?: string | null }) => {
  const { messages, hasOlderMessages, isLoadingOlder } = useSessionMessages(props.session.id);
  return (
    <ChatListInternal
      metadata={props.session.metadata}
      sessionId={props.session.id}
      messages={messages}
      hasOlderMessages={hasOlderMessages}
      isLoadingOlder={isLoadingOlder}
      footerNotice={props.footerNotice}
    />
  );
});

const ListHeader = React.memo(() => {
  const headerHeight = useHeaderHeight();
  const safeArea = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: headerHeight + safeArea.top + 32,
      }}
    />
  );
});

const OlderMessagesLoader = React.memo((props: { isLoading: boolean }) => {
  if (!props.isLoading) return <ListHeader />;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', paddingVertical: 16 }}>
      <ActivityIndicator size="small" />
    </View>
  );
});

const ListFooter = React.memo((props: { sessionId: string; notice?: string | null }) => {
  const session = useSession(props.sessionId)!;
  return (
    <ChatFooter
      controlledByUser={session.agentState?.controlledByUser || false}
      notice={props.notice}
    />
  );
});

const ChatListInternal = React.memo(
  (props: {
    metadata: Metadata | null;
    sessionId: string;
    messages: Message[];
    hasOlderMessages: boolean;
    isLoadingOlder: boolean;
    footerNotice?: string | null;
  }) => {
    const keyExtractor = useCallback((item: any) => item.id, []);
    const renderItem = useCallback(
      ({ item }: { item: any }) => (
        <MessageView message={item} metadata={props.metadata} sessionId={props.sessionId} />
      ),
      [props.metadata, props.sessionId]
    );

    // inverted FlatList: "end" = top of the visual list = older messages
    const handleEndReached = useCallback(() => {
      if (props.hasOlderMessages && !props.isLoadingOlder) {
        sync.loadOlderMessages(props.sessionId);
      }
    }, [props.sessionId, props.hasOlderMessages, props.isLoadingOlder]);

    return (
      <FlatList
        data={props.messages}
        inverted={true}
        keyExtractor={keyExtractor}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={7}
        onEndReached={props.hasOlderMessages ? handleEndReached : undefined}
        onEndReachedThreshold={0.5}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 10,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
        renderItem={renderItem}
        ListHeaderComponent={<ListFooter sessionId={props.sessionId} notice={props.footerNotice} />}
        ListFooterComponent={<OlderMessagesLoader isLoading={props.isLoadingOlder} />}
      />
    );
  }
);
