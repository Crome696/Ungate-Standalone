import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirSyncMock, writeFileSyncMock, rmSyncMock, rmdirSyncMock, existsSyncMock, readFileSyncMock, sleepMock, killMock } =
	vi.hoisted(() => {
		const mkdirSyncMock = vi.fn();
		const writeFileSyncMock = vi.fn();
		const rmSyncMock = vi.fn();
		const rmdirSyncMock = vi.fn();
		const existsSyncMock = vi.fn();
		const readFileSyncMock = vi.fn();
		const sleepMock = vi.fn<(ms: number) => Promise<void>>();
		const killMock = vi.fn();

		return {
			mkdirSyncMock,
			writeFileSyncMock,
			rmSyncMock,
			rmdirSyncMock,
			existsSyncMock,
			readFileSyncMock,
			sleepMock,
			killMock
		};
	});

vi.mock('node:fs', () => {
	return {
		mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
		writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
		rmSync: (...args: unknown[]) => rmSyncMock(...args),
		rmdirSync: (...args: unknown[]) => rmdirSyncMock(...args),
		existsSync: (...args: unknown[]) => existsSyncMock(...args),
		readFileSync: (...args: unknown[]) => readFileSyncMock(...args)
	};
});

vi.mock('@ungate/shared', () => {
	return {
		sleep: sleepMock
	};
});

import { CrossProcessLock } from '../../src/utils/cross-process-lock';

describe('CrossProcessLock', () => {
	beforeEach(() => {
		mkdirSyncMock.mockReset();
		writeFileSyncMock.mockReset();
		rmSyncMock.mockReset();
		rmdirSyncMock.mockReset();
		existsSyncMock.mockReset();
		readFileSyncMock.mockReset();
		sleepMock.mockReset();
		killMock.mockReset();
		vi.useRealTimers();
	});

	it('does not steal a lock while the current holder is alive', async () => {
		let attempts = 0;
		mkdirSyncMock.mockImplementation(() => {
			attempts += 1;

			if (attempts === 1) {
				const error = new Error('exists') as NodeJS.ErrnoException;
				error.code = 'EEXIST';
				throw error;
			}
		});
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue('1234');
		sleepMock.mockImplementation(() => Promise.resolve());
		vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2600).mockReturnValueOnce(2601);
		vi.stubGlobal('process', { ...process, kill: (...args: unknown[]) => killMock(...args) });
		killMock.mockImplementation(() => {});

		const release = await CrossProcessLock.acquire('runtime-state.lock', 1500);

		expect(killMock).toHaveBeenCalledWith(1234, 0);
		expect(rmSyncMock).not.toHaveBeenCalled();
		expect(writeFileSyncMock).toHaveBeenCalledTimes(1);

		release();
	});
});
