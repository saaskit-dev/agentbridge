import { describe, expect, it, vi } from 'vitest';
import {
  buildMachineRoom,
  buildSessionRoom,
  buildUserRoom,
  hasRemainingConnections,
} from '../connectionRooms';

describe('connectionRooms', () => {
  it('builds stable room ids', () => {
    expect(buildUserRoom('user-1')).toBe('user:user-1');
    expect(buildSessionRoom('user-1', 'session-1')).toBe('session:user-1:session-1');
    expect(buildMachineRoom('user-1', 'machine-1')).toBe('machine:user-1:machine-1');
  });

  it('detects remaining sockets in a room', async () => {
    const allSockets = vi.fn().mockResolvedValue(new Set(['socket-1']));
    const io = {
      in: vi.fn().mockReturnValue({ allSockets }),
    } as any;

    await expect(hasRemainingConnections(io, 'session:user-1:session-1')).resolves.toBe(true);
    expect(io.in).toHaveBeenCalledWith('session:user-1:session-1');
  });

  it('returns false when a room is empty', async () => {
    const io = {
      in: vi.fn().mockReturnValue({
        allSockets: vi.fn().mockResolvedValue(new Set()),
      }),
    } as any;

    await expect(hasRemainingConnections(io, 'machine:user-1:machine-1')).resolves.toBe(false);
  });
});
