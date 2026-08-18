import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
const existsSyncMock = vi.fn();
const fetchMock = vi.fn();
const copyFileSyncMock = vi.fn();
const renameSyncMock = vi.fn();
const rmSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock('node:child_process', () => {
	return {
		execFile: (...args: unknown[]) => execFileMock(...args)
	};
});

vi.mock('node:fs', () => {
	return {
		existsSync: (...args: unknown[]) => existsSyncMock(...args),
		readFileSync: vi.fn(() => JSON.stringify({ version: '11.10.0' })),
		realpathSync: vi.fn((target: string) => target),
		mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
		copyFileSync: (...args: unknown[]) => copyFileSyncMock(...args),
		rmSync: (...args: unknown[]) => rmSyncMock(...args),
		renameSync: (...args: unknown[]) => renameSyncMock(...args)
	};
});

vi.mock('../../src/utils/cross-process-lock', () => {
	return {
		CrossProcessLock: {
			acquire: vi.fn(() => Promise.resolve(() => {}))
		}
	};
});

vi.mock('../../src/utils/node-resolver', () => {
	return {
		NodeResolver: {
			inspect: vi.fn(() => {
				return { abi: '137', platform: 'win32', arch: 'x64' };
			})
		}
	};
});

const isApiStartSuppressedMock = vi.fn<() => boolean>(() => false);
const suppressApiAutoStartMock = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.mock('../../src/runtime-state', () => {
	return {
		RuntimeStateStore: {
			read: vi.fn(() => {
				return {
					api: {
						status: 'error',
						lastError: '[native] better-sqlite3 prebuilt installation failed'
					}
				};
			}),
			isApiStartSuppressed: (...args: unknown[]) => isApiStartSuppressedMock(...args),
			suppressApiAutoStart: (...args: unknown[]) => suppressApiAutoStartMock(...args)
		}
	};
});

import { BetterSqlite3Installer } from '../../src/utils/better-sqlite3-installer';

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

function mockExecFileSuccess(): void {
	execFileMock.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
		callback(null, { stdout: '', stderr: '' });
	});
}

describe('BetterSqlite3Installer', () => {
	beforeEach(() => {
		isApiStartSuppressedMock.mockReset();
		isApiStartSuppressedMock.mockReturnValue(false);
		suppressApiAutoStartMock.mockReset();
		execFileMock.mockReset();
		existsSyncMock.mockReset();
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		copyFileSyncMock.mockReset();
		renameSyncMock.mockReset();
		rmSyncMock.mockReset();
		mkdirSyncMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('skips download when the installed native binary already loads', async () => {
		mockExecFileSuccess();
		existsSyncMock.mockImplementation((target) => String(target).endsWith('better_sqlite3.installed.node'));

		await BetterSqlite3Installer.ensureInstalled('/tmp/ungate-api', 'node', { onLog: vi.fn() });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(execFileMock).toHaveBeenCalledTimes(1);

		const execArgs = execFileMock.mock.calls[0]?.[1];
		const script = Array.isArray(execArgs) ? String(execArgs[1]) : '';

		expect(script).toContain('nativeBinding');
		expect(script).toContain('better_sqlite3.installed.node');
	});

	it('does not call https when a concurrent install already made the binary loadable', async () => {
		execFileMock
			.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
				const error = new Error('load failed') as Error & { stderr?: string };
				error.stderr = '';
				callback(error, { stdout: '', stderr: '' });
			})
			.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
				callback(null, { stdout: '', stderr: '' });
			})
			.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
				callback(null, { stdout: '', stderr: '' });
			});

		existsSyncMock.mockReturnValue(true);

		await BetterSqlite3Installer.ensureInstalled('/tmp/ungate-api', 'node', { onLog: vi.fn() });

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not retry install after a shared native install failure was recorded', async () => {
		isApiStartSuppressedMock.mockReturnValue(true);

		await expect(BetterSqlite3Installer.ensureInstalled('/tmp/ungate-api', 'node', { onLog: vi.fn() })).rejects.toThrow(
			'[native] better-sqlite3 prebuilt installation failed'
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(execFileMock).not.toHaveBeenCalled();
	});

	it('stores the downloaded binary in the installed native path', async () => {
		execFileMock
			.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
				const error = new Error('load failed') as Error & { stderr?: string };
				error.stderr = '';
				callback(error, { stdout: '', stderr: '' });
			})
			.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
				const error = new Error('load failed') as Error & { stderr?: string };
				error.stderr = '';
				callback(error, { stdout: '', stderr: '' });
			})
			.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
				callback(null, { stdout: '', stderr: '' });
			});
		existsSyncMock.mockImplementation((target) => {
			if (String(target).endsWith('better_sqlite3.installed.node')) {
				return false;
			}

			if (String(target).endsWith('build/Release/better_sqlite3.node')) {
				return true;
			}

			return false;
		});
		const installer = BetterSqlite3Installer as unknown as {
			downloadAndExtract(url: string, extractDir: string): Promise<void>;
		};

		installer.downloadAndExtract = vi.fn().mockResolvedValue(undefined);

		await BetterSqlite3Installer.ensureInstalled('/tmp/ungate-api', 'node', { onLog: vi.fn() });

		expect(renameSyncMock).toHaveBeenCalledWith(
			expect.stringContaining('better_sqlite3.installed.node'),
			expect.stringContaining('better_sqlite3.installed.node')
		);
	});
});
