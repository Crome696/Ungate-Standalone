import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		execFileMock: vi.fn(),
		existsSyncMock: vi.fn(),
		fetchMock: vi.fn()
	};
});

vi.mock('node:child_process', () => {
	return {
		execFile: mocks.execFileMock
	};
});

vi.mock('node:fs', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs')>();

	return {
		...original,
		existsSync: mocks.existsSyncMock
	};
});

import { Sqlite3CliResolver } from '../../src/utils/sqlite3-cli-resolver';

describe('Sqlite3CliResolver', () => {
	beforeEach(() => {
		mocks.execFileMock.mockReset();
		mocks.existsSyncMock.mockReset();
		mocks.fetchMock.mockReset();
		vi.stubGlobal('fetch', mocks.fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns the bundled install path when it already exists', async () => {
		mocks.existsSyncMock.mockImplementation(
			(target) => String(target).endsWith('sqlite3.exe') || String(target).endsWith('/sqlite3')
		);

		const resolved = await Sqlite3CliResolver.resolve();

		expect(resolved).toBe(Sqlite3CliResolver.getInstalledPath());
		expect(mocks.execFileMock).not.toHaveBeenCalled();
	});

	it('falls back to sqlite3 from PATH before downloading', async () => {
		mocks.existsSyncMock.mockImplementation((target) => String(target) === '/usr/bin/sqlite3');
		mocks.execFileMock.mockImplementation(
			(command: string, args: string[], callback: (error: Error | null, result: { stdout: string }) => void) => {
				if (command === 'which' && args[0] === 'sqlite3') {
					callback(null, { stdout: '/usr/bin/sqlite3\n' });

					return;
				}

				callback(new Error('not found'), { stdout: '' });
			}
		);

		const resolved = await Sqlite3CliResolver.resolve();

		expect(resolved).toBe('/usr/bin/sqlite3');
		expect(mocks.fetchMock).not.toHaveBeenCalled();
	});

	it('uses where.exe on win32 when searching PATH', async () => {
		const originalPlatform = process.platform;

		Object.defineProperty(process, 'platform', { value: 'win32' });
		mocks.existsSyncMock.mockImplementation((target) => String(target) === 'C:\\Tools\\sqlite3.exe');
		mocks.execFileMock.mockImplementation(
			(command: string, args: string[], callback: (error: Error | null, result: { stdout: string }) => void) => {
				if (command === 'where.exe' && args[0] === 'sqlite3') {
					callback(null, { stdout: 'C:\\Tools\\sqlite3.exe\r\n' });

					return;
				}

				callback(new Error('not found'), { stdout: '' });
			}
		);

		const resolved = await Sqlite3CliResolver.resolve();

		Object.defineProperty(process, 'platform', { value: originalPlatform });

		expect(resolved).toBe('C:\\Tools\\sqlite3.exe');
	});

	it('downloads sqlite3 into ~/.ungate/bin when nothing is available locally', async () => {
		const installedPath = Sqlite3CliResolver.getInstalledPath();

		mocks.existsSyncMock.mockImplementation((target) => {
			const value = String(target);

			return value.startsWith(os.tmpdir()) && value.endsWith(`${path.sep}sqlite3`);
		});
		mocks.execFileMock.mockImplementation(
			(command: string, args: string[], callback: (error: Error | null, result?: { stdout: string }) => void) => {
				if (command === 'which') {
					callback(new Error('not found'));

					return;
				}

				if (command === 'unzip') {
					const destDir = args[args.indexOf('-d') + 1];

					fs.mkdirSync(destDir, { recursive: true });
					fs.writeFileSync(path.join(destDir, Sqlite3CliResolver.getBinaryName()), '');
					callback(null);

					return;
				}

				callback(new Error(`unexpected command: ${command}`));
			}
		);
		mocks.fetchMock.mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer)
		});

		const resolved = await Sqlite3CliResolver.resolve();

		fs.rmSync(installedPath, { force: true });

		expect(resolved).toBe(installedPath);
		expect(mocks.fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/www\.sqlite\.org\/\d{4}\/sqlite-tools-/));
	});
});
