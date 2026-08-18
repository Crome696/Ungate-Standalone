import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		runtimeReadMock: vi.fn(),
		runtimeMutateMock: vi.fn(),
		executeCommandMock: vi.fn(),
		existsSyncMock: vi.fn(() => true)
	};
});

const { runtimeReadMock, runtimeMutateMock, executeCommandMock, existsSyncMock } = mocks;

vi.mock('vscode', () => {
	return {
		workspace: {
			createFileSystemWatcher: vi.fn(() => ({
				onDidChange: vi.fn(),
				onDidCreate: vi.fn(),
				dispose: vi.fn()
			}))
		},
		Uri: {
			file: (value: string) => ({ fsPath: value })
		},
		RelativePattern: class {
			constructor(
				public readonly base: unknown,
				public readonly pattern: string
			) {}
		},
		commands: {
			executeCommand: mocks.executeCommandMock
		}
	};
});

vi.mock('../../src/runtime-state', () => {
	return {
		RuntimeStateStore: {
			read: mocks.runtimeReadMock,
			mutate: mocks.runtimeMutateMock
		}
	};
});

vi.mock('../../src/utils/cursor-state-db-reader', () => {
	return {
		CursorStateDbReader: class {
			init() {
				return Promise.resolve(null);
			}

			readItemTableValue() {
				return Promise.resolve(null);
			}
		}
	};
});

vi.mock('node:fs', () => {
	return {
		existsSync: mocks.existsSyncMock
	};
});

vi.mock('node:child_process', () => {
	return {
		execFile: vi.fn()
	};
});

import { OpenAiKeyFix } from '../../src/openai-key-fix';
import { config as runtimeStateConfig } from '../../src/runtime-state/config';

import { TestHelper } from './helpers/test-helper';

interface OpenAiKeyFixInternals {
	state: { enabled: boolean; activated: boolean; running: boolean };
	runtime: { pollInterval: NodeJS.Timeout | null };
	readUseOpenAiKey(): Promise<boolean | undefined>;
	checkAndFix(): Promise<void>;
	reconcileMonitoring(): void;
}

async function createLeaderKeyFix(windowIds: string[] = ['window-a']): Promise<{
	keyFix: OpenAiKeyFix;
	internals: OpenAiKeyFixInternals;
}> {
	const runtimeState = TestHelper.createRuntimeState(windowIds, null);
	runtimeState.keyFix.enabled = true;
	runtimeReadMock.mockReturnValue(runtimeState);

	const keyFix = new OpenAiKeyFix(
		{ globalStorageUri: { fsPath: '/tmp/global-storage/ungate' } } as never,
		() => {},
		() => {},
		() => true
	);
	const internals = keyFix as unknown as OpenAiKeyFixInternals;

	internals.state.activated = true;
	internals.state.enabled = true;
	await keyFix.activate();

	return { keyFix, internals };
}

describe('OpenAiKeyFix', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	beforeEach(() => {
		executeCommandMock.mockReset();
		runtimeReadMock.mockReset();
		runtimeMutateMock.mockReset();
		existsSyncMock.mockReset();
		existsSyncMock.mockReturnValue(true);
		runtimeMutateMock.mockImplementation((mutator: (state: ReturnType<typeof TestHelper.createRuntimeState>) => unknown) => {
			return Promise.resolve(mutator(runtimeReadMock()));
		});
		runtimeReadMock.mockReturnValue(TestHelper.createRuntimeState(['window-a'], null));
	});

	it('does not re-enable the key when shared key-fix is disabled', async () => {
		const runtimeState = TestHelper.createRuntimeState(['window-a'], null);
		runtimeState.keyFix.enabled = false;
		runtimeReadMock.mockReturnValue(runtimeState);

		const keyFix = new OpenAiKeyFix(
			{ globalStorageUri: { fsPath: '/tmp/global-storage/ungate' } } as never,
			() => {},
			() => {},
			() => true
		);
		const internals = keyFix as unknown as OpenAiKeyFixInternals;

		internals.state.activated = true;
		internals.state.enabled = true;
		internals.runtime.pollInterval = setInterval(() => {}, 60_000);

		await internals.checkAndFix();

		expect(executeCommandMock).not.toHaveBeenCalled();
		expect(internals.state.enabled).toBe(false);
		expect(internals.runtime.pollInterval).toBeNull();
	});

	it('keeps the poll timer running when reconcileMonitoring is called again while already monitoring', async () => {
		const { internals } = await createLeaderKeyFix();

		internals.reconcileMonitoring();
		const pollInterval = internals.runtime.pollInterval;

		expect(pollInterval).not.toBeNull();
		internals.reconcileMonitoring();
		expect(internals.runtime.pollInterval).toBe(pollInterval);
	});

	it('re-enables the Cursor key when monitoring poll detects it was turned off', async () => {
		vi.useFakeTimers();
		const { internals } = await createLeaderKeyFix();
		const readSpy = vi.spyOn(internals, 'readUseOpenAiKey').mockResolvedValue(false);

		internals.reconcileMonitoring();
		await vi.advanceTimersByTimeAsync(runtimeStateConfig.openAiKeyFix.pollMs);

		expect(readSpy).toHaveBeenCalled();
		expect(executeCommandMock).toHaveBeenCalledWith('aiSettings.usingOpenAIKey.toggle');
	});

	it('re-enables the Cursor key when checkAndFix sees useOpenAIKey is false', async () => {
		const { internals } = await createLeaderKeyFix();

		vi.spyOn(internals, 'readUseOpenAiKey').mockResolvedValue(false);
		await internals.checkAndFix();

		expect(executeCommandMock).toHaveBeenCalledWith('aiSettings.usingOpenAIKey.toggle');
	});

	it('does not start monitoring when the window is not the leader', () => {
		const runtimeState = TestHelper.createRuntimeState(['window-a', 'window-b'], null);
		runtimeState.keyFix.enabled = true;
		runtimeReadMock.mockReturnValue(runtimeState);

		const keyFix = new OpenAiKeyFix(
			{ globalStorageUri: { fsPath: '/tmp/global-storage/ungate' } } as never,
			() => {},
			() => {},
			() => false
		);
		const internals = keyFix as unknown as OpenAiKeyFixInternals;

		internals.state.activated = true;
		internals.state.enabled = true;
		internals.reconcileMonitoring();

		expect(internals.runtime.pollInterval).toBeNull();
	});

	it('enables the Cursor key on activate when runtime state was already enabled before activation', async () => {
		const runtimeState = TestHelper.createRuntimeState(['window-a'], null);
		runtimeState.keyFix.enabled = true;
		runtimeReadMock.mockReturnValue(runtimeState);

		const keyFix = new OpenAiKeyFix(
			{ globalStorageUri: { fsPath: '/tmp/global-storage/ungate' } } as never,
			() => {},
			() => {},
			() => true
		);
		const internals = keyFix as unknown as OpenAiKeyFixInternals;

		await keyFix.applySharedState(true);
		expect(keyFix.isEnabled()).toBe(true);
		expect(internals.state.enabled).toBe(false);

		vi.spyOn(internals, 'readUseOpenAiKey').mockResolvedValue(false);
		await keyFix.activate();

		expect(executeCommandMock).toHaveBeenCalledWith('aiSettings.usingOpenAIKey.toggle');
		expect(internals.state.enabled).toBe(true);
	});

	it('enables the Cursor key in the window where the user toggled it, even when it is not the leader', async () => {
		const runtimeState = TestHelper.createRuntimeState(['window-a', 'window-b'], null);
		runtimeState.keyFix.enabled = false;
		runtimeReadMock.mockReturnValue(runtimeState);

		const keyFix = new OpenAiKeyFix(
			{ globalStorageUri: { fsPath: '/tmp/global-storage/ungate' } } as never,
			() => {},
			() => {},
			() => false
		);
		const internals = keyFix as unknown as OpenAiKeyFixInternals;

		internals.state.activated = true;
		vi.spyOn(internals, 'readUseOpenAiKey').mockResolvedValue(false);
		await keyFix.setEnabledByUser(true);

		expect(executeCommandMock).toHaveBeenCalledWith('aiSettings.usingOpenAIKey.toggle');
		expect(keyFix.isEnabled()).toBe(true);
	});
});
