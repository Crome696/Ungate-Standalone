import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();
const existsSyncMock = vi.fn();

vi.mock('node:child_process', () => {
	return {
		spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
		spawn: vi.fn()
	};
});

vi.mock('node:fs', () => {
	return {
		existsSync: (...args: unknown[]) => existsSyncMock(...args),
		readdirSync: vi.fn(() => [])
	};
});

import { NodeResolver } from '../../src/utils/node-resolver';

describe('NodeResolver', () => {
	const originalPlatform = process.platform;

	beforeEach(() => {
		spawnSyncMock.mockReset();
		existsSyncMock.mockReset();
	});

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: originalPlatform });
	});

	it('returns override path when UNGATE_NODE_BIN is provided via resolve argument', () => {
		expect(NodeResolver.resolve('C:\\Program Files\\nodejs\\node.exe')).toBe('C:\\Program Files\\nodejs\\node.exe');
	});

	it('prefers the first usable Windows candidate', () => {
		Object.defineProperty(process, 'platform', { value: 'win32' });
		process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
		process.env.ProgramFiles = 'C:\\Program Files';

		const programFilesNode = path.join(process.env.ProgramFiles, 'nodejs', 'node.exe');

		spawnSyncMock.mockImplementation((command) => {
			if (command === 'node') {
				return { error: new Error('ENOENT'), status: 1, stdout: '', stderr: '', pid: 0, output: [null, '', ''], signal: null };
			}

			if (command === programFilesNode) {
				return {
					error: undefined,
					status: 0,
					stdout: 'v24.0.0\n',
					stderr: '',
					pid: 1,
					output: [null, 'v24.0.0\n', ''],
					signal: null
				};
			}

			return { error: new Error('ENOENT'), status: 1, stdout: '', stderr: '', pid: 0, output: [null, '', ''], signal: null };
		});

		existsSyncMock.mockImplementation((target) => {
			return String(target).endsWith('node.exe');
		});

		expect(NodeResolver.resolve()).toBe(programFilesNode);
	});

	it('inspect returns abi platform and arch from runtime output', () => {
		spawnSyncMock.mockReturnValue({
			error: undefined,
			status: 0,
			stdout: '{"abi":"137","platform":"win32","arch":"x64"}',
			stderr: '',
			pid: 1,
			output: [null, '{"abi":"137","platform":"win32","arch":"x64"}', ''],
			signal: null
		});

		expect(NodeResolver.inspect('C:\\Program Files\\nodejs\\node.exe')).toEqual({
			abi: '137',
			platform: 'win32',
			arch: 'x64'
		});
	});
});
