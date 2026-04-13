import type { CachedCapabilitiesRow, CachedMessage, MessageDB } from './messageDBSchema';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

let invokePromise: Promise<TauriInvoke> | null = null;

async function getInvoke(): Promise<TauriInvoke> {
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core').then(mod => mod.invoke);
  }
  return invokePromise;
}

async function call<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  const invoke = await getInvoke();
  return invoke<T>(command, payload);
}

export const desktopMessageDB: MessageDB = {
  async init() {
    await call('desktop_message_db_init');
  },

  async getMessages(sessionId, opts) {
    return call<CachedMessage[]>('desktop_message_db_get_messages', {
      payload: {
        session_id: sessionId,
        limit: opts.limit,
        before_seq: opts.beforeSeq ?? null,
      },
    });
  },

  async getLastSeq(sessionId) {
    return call<number>('desktop_message_db_get_last_seq', {
      payload: { session_id: sessionId },
    });
  },

  async upsertMessages(sessionId, messages) {
    if (messages.length === 0) return;
    await call('desktop_message_db_upsert_messages', {
      payload: { session_id: sessionId, messages },
    });
  },

  async updateLastSeq(sessionId, seq) {
    await call('desktop_message_db_update_last_seq', {
      payload: { session_id: sessionId, seq },
    });
  },

  async upsertMessagesAndSeq(sessionId, messages, seq) {
    await call('desktop_message_db_upsert_messages_and_seq', {
      payload: { session_id: sessionId, messages, seq },
    });
  },

  async deleteSession(sessionId) {
    await call('desktop_message_db_delete_session', {
      payload: { session_id: sessionId },
    });
  },

  async deleteAll() {
    await call('desktop_message_db_delete_all');
  },

  async getCapabilities(machineId, agentType) {
    return call<CachedCapabilitiesRow | null>('desktop_message_db_get_capabilities', {
      payload: { machine_id: machineId, agent_type: agentType },
    });
  },

  async upsertCapabilities(row) {
    await call('desktop_message_db_upsert_capabilities', { payload: row });
  },

  async kvGetAll(namespace) {
    return call<Array<{ key: string; value: string }>>('desktop_message_db_kv_get_all', {
      payload: { namespace },
    });
  },

  async kvSet(namespace, key, value) {
    await call('desktop_message_db_kv_set', {
      payload: { namespace, key, value },
    });
  },

  async kvDelete(namespace, key) {
    await call('desktop_message_db_kv_delete', {
      payload: { namespace, key },
    });
  },

  async kvDeleteAll(namespace) {
    await call('desktop_message_db_kv_delete_all', {
      payload: { namespace },
    });
  },
};
