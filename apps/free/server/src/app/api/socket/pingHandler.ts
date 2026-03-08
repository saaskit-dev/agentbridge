import { Socket } from 'socket.io';
import { Logger } from '@agentbridge/core/telemetry';
const log = new Logger('app/api/socket/pingHandler');

export function pingHandler(socket: Socket) {
  socket.on('ping', async (callback: (response: any) => void) => {
    try {
      callback({});
    } catch (error) {
      log.error(`Error in ping: ${error}`);
    }
  });
}
