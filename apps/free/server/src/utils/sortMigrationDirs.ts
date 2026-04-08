export function sortMigrationDirs(dirs: string[]): string[] {
  const migrationOrder = new Map<string, number>([
    ['init', 0],
    ['add_archived_at_to_session', 1],
    ['add_reconnect_token', 2],
    ['add_session_capabilities', 3],
    ['session_status_enum', 4],
    ['add_session_machine_id', 5],
    ['add_trace_id_to_session_message', 6],
    ['drop_session_tag', 7],
  ]);

  return [...dirs].sort((a, b) => {
    const orderA = migrationOrder.get(a);
    const orderB = migrationOrder.get(b);

    if (orderA !== undefined && orderB !== undefined) {
      return orderA - orderB;
    }
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    return a.localeCompare(b);
  });
}
