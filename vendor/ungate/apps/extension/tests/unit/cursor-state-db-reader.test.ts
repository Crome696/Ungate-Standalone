import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		resolveMock: vi.fn(),
		execFileMock: vi.fn()
	};
});

vi.mock('../../src/utils/sqlite3-cli-resolver', () => {
	return {
		Sqlite3CliResolver: {
			resolve: mocks.resolveMock
		}
	};
});

vi.mock('node:child_process', () => {
	return {
		execFile: mocks.execFileMock
	};
});

import { CursorStateDbReader } from '../../src/utils/cursor-state-db-reader';

describe('CursorStateDbReader', () => {
	beforeEach(() => {
		mocks.resolveMock.mockReset();
		mocks.execFileMock.mockReset();
	});

	it('reads ItemTable values through the resolved sqlite3 CLI', async () => {
		mocks.resolveMock.mockResolvedValue('/usr/bin/sqlite3');
		mocks.execFileMock.mockImplementation(
			(_command: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
				callback(null, { stdout: '{"useOpenAIKey":true}\n' });
			}
		);

		const reader = new CursorStateDbReader();

		const initResult = await reader.init();
		const value = await reader.readItemTableValue('/tmp/state.vscdb', 'cursorAuth/openAIKey');

		expect(initResult).toBeNull();
		expect(value).toBe('{"useOpenAIKey":true}');
		expect(mocks.execFileMock).toHaveBeenCalledWith(
			'/usr/bin/sqlite3',
			['/tmp/state.vscdb', "SELECT value FROM ItemTable WHERE key = 'cursorAuth/openAIKey';"],
			expect.any(Function)
		);
	});

	it('reports unavailable when sqlite3 CLI cannot be resolved', async () => {
		mocks.resolveMock.mockResolvedValue(null);

		const reader = new CursorStateDbReader();

		const initResult = await reader.init();
		const value = await reader.readItemTableValue('/tmp/state.vscdb', 'cursorAuth/openAIKey');

		expect(initResult).toBe('SQLite CLI could not be prepared');
		expect(value).toBeNull();
	});

	it('caches init result', async () => {
		mocks.resolveMock.mockResolvedValue('/usr/bin/sqlite3');

		const reader = new CursorStateDbReader();

		const firstInit = await reader.init();
		const secondInit = await reader.init();

		expect(firstInit).toBeNull();
		expect(secondInit).toBeNull();
		expect(mocks.resolveMock).toHaveBeenCalledTimes(1);
	});
});
