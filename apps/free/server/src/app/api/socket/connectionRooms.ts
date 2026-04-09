import type { Server } from 'socket.io';

export function buildUserRoom(userId: string): string {
  return `user:${userId}`;
}

export function buildSessionRoom(userId: string, sessionId: string): string {
  return `session:${userId}:${sessionId}`;
}

export function buildMachineRoom(userId: string, machineId: string): string {
  return `machine:${userId}:${machineId}`;
}

export async function hasRemainingConnections(
  io: Pick<Server, 'in'>,
  room: string
): Promise<boolean> {
  const socketIds = await io.in(room).allSockets();
  return socketIds.size > 0;
}
