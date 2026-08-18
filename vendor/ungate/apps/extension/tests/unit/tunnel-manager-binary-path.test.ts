import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		existsSyncMock: vi.fn(),
		renameSyncMock: vi.fn(),
		installMock: vi.fn(),
		useMock: vi.fn(),
		binExport: '/dev/cloudflared-package/bin/cloudflared'
	};
});

vi.mock('cloudflared', () => {
	return {
		bin: mocks.binExport,
		install: mocks.installMock,
		use: mocks.useMock,
		Tunnel: {
			quick: vi.fn(() => ({
				on: vi.fn(),
				stop: vi.fn()
			}))
		}
	};
});

vi.mock('node:fs', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs')>();

	return {
		...original,
		existsSync: mocks.existsSyncMock,
		renameSync: mocks.renameSyncMock
	};
});

vi.mock('../../src/runtime-state', () => {
	return {
		RuntimeStateStore: {
			mutate: vi.fn((mutator: (state: unknown) => unknown) => Promise.resolve(mutator({ tunnel: {} }))),
			read: vi.fn(() => ({ clients: {} })),
			hasLiveClients: vi.fn(() => true)
		}
	};
});

import { TunnelManager } from '../../src/tunnel-manager';

describe('TunnelManager cloudflared binary path', () => {
	const binDir = path.join(os.homedir(), '.ungate', 'bin');

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('installs cloudflared.exe on win32', async () => {
		const originalPlatform = process.platform;

		Object.defineProperty(process, 'platform', { value: 'win32' });

		const expectedPath = path.join(binDir, 'cloudflared.exe');

		mocks.existsSyncMock.mockReturnValue(false);
		mocks.installMock.mockResolvedValue(expectedPath);

		const manager = new TunnelManager(
			'window-a',
			() => true,
			() => {},
			() => {}
		);

		await manager.start(47821);

		Object.defineProperty(process, 'platform', { value: originalPlatform });

		expect(mocks.installMock).toHaveBeenCalledWith(expectedPath);
		expect(mocks.useMock).toHaveBeenCalledWith(expectedPath);
	});

	it('renames a legacy Windows install without .exe extension', async () => {
		const originalPlatform = process.platform;

		Object.defineProperty(process, 'platform', { value: 'win32' });

		const legacyPath = path.join(binDir, 'cloudflared');
		const expectedPath = path.join(binDir, 'cloudflared.exe');

		mocks.existsSyncMock.mockImplementation((target) => {
			const value = String(target);

			return value === legacyPath;
		});

		const manager = new TunnelManager(
			'window-a',
			() => true,
			() => {},
			() => {}
		);

		await manager.start(47821);

		Object.defineProperty(process, 'platform', { value: originalPlatform });

		expect(mocks.renameSyncMock).toHaveBeenCalledWith(legacyPath, expectedPath);
		expect(mocks.useMock).toHaveBeenCalledWith(expectedPath);
		expect(mocks.installMock).not.toHaveBeenCalled();
	});
});
