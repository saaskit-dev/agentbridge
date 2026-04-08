import { describe, expect, it } from 'vitest';
import { sortMigrationDirs } from '../sortMigrationDirs';

describe('sortMigrationDirs', () => {
  it('keeps init first and session_status_enum before add_session_machine_id', () => {
    expect(
      sortMigrationDirs([
        'add_session_machine_id',
        'init',
        'add_archived_at_to_session',
        'session_status_enum',
        'add_session_capabilities',
      ])
    ).toEqual([
      'init',
      'add_archived_at_to_session',
      'add_session_capabilities',
      'session_status_enum',
      'add_session_machine_id',
    ]);
  });
});
