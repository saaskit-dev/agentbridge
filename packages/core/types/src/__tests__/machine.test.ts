import { describe, it, expect } from 'vitest';
import type {
  MachineMetadata,
  DaemonStatus,
  DaemonState,
  Machine,
  // Legacy aliases
  Device,
  DeviceMetadata,
} from '../machine';

describe('machine types', () => {
  describe('MachineMetadata', () => {
    it('accepts valid machine metadata', () => {
      const metadata: MachineMetadata = {
        host: 'MacBook-Pro',
        platform: 'darwin',
        version: '1.0.0',
        homeDir: '/Users/test',
      };

      expect(metadata.host).toBe('MacBook-Pro');
      expect(metadata.platform).toBe('darwin');
    });
  });

  describe('DaemonStatus', () => {
    it('accepts valid status values', () => {
      const running: DaemonStatus = 'running';
      const shuttingDown: DaemonStatus = 'shutting-down';
      const stopped: DaemonStatus = 'stopped';

      expect(running).toBe('running');
      expect(shuttingDown).toBe('shutting-down');
      expect(stopped).toBe('stopped');
    });
  });

  describe('DaemonState', () => {
    it('accepts valid daemon state', () => {
      const state: DaemonState = {
        status: 'running',
        pid: 12345,
        httpPort: 8080,
        startedAt: Date.now(),
      };

      expect(state.status).toBe('running');
      expect(state.pid).toBe(12345);
    });

    it('accepts minimal daemon state', () => {
      const state: DaemonState = {
        status: 'stopped',
      };

      expect(state.status).toBe('stopped');
      expect(state.pid).toBeUndefined();
    });
  });

  describe('Machine', () => {
    it('accepts valid machine structure', () => {
      const machine: Machine = {
        id: 'machine-123',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: null,
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
      };

      expect(machine.id).toBe('machine-123');
      expect(machine.active).toBe(true);
    });

    it('accepts machine with full data', () => {
      const machine: Machine = {
        id: 'machine-456',
        seq: 10,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: {
          host: 'server-01',
          platform: 'linux',
          version: '2.0.0',
          homeDir: '/home/user',
        },
        metadataVersion: 5,
        daemonState: {
          status: 'running',
          pid: 54321,
          httpPort: 3000,
          startedAt: Date.now() - 1800000,
        },
        daemonStateVersion: 3,
      };

      expect(machine.metadata?.host).toBe('server-01');
      expect(machine.daemonState?.status).toBe('running');
    });
  });

  describe('Legacy aliases', () => {
    it('Device is an alias for Machine', () => {
      const device: Device = {
        id: 'device-123',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: null,
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
      };

      expect(device.id).toBe('device-123');
    });

    it('DeviceMetadata is an alias for MachineMetadata', () => {
      const deviceMetadata: DeviceMetadata = {
        host: 'legacy-device',
        platform: 'win32',
        version: '0.1.0',
        homeDir: 'C:\\Users\\test',
      };

      expect(deviceMetadata.host).toBe('legacy-device');
    });
  });
});
