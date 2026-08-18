import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sharedLogTestBaseDir } from './helpers/shared-log-temp-dir';

vi.mock('../../src/runtime-state/config', async () => {
	const { sharedLogTestBaseDir: baseDir, sharedLogTestPath } = await import('./helpers/shared-log-temp-dir');

	return {
		config: {
			baseDir,
			paths: {
				sharedLogPath: sharedLogTestPath
			}
		}
	};
});

// eslint-disable-next-line import-x/order -- module under test loads after config mock
import { SharedLogStore } from '../../src/runtime-state/shared-log-store';

describe('SharedLogStore', () => {
	beforeEach(() => {
		fs.rmSync(sharedLogTestBaseDir, { recursive: true, force: true });
	});

	afterEach(() => {
		fs.rmSync(sharedLogTestBaseDir, { recursive: true, force: true });
	});

	it('clears only the selected source from the shared log file', () => {
		SharedLogStore.append('api', { timestamp: 1, level: 'info', message: 'api-1' });
		SharedLogStore.append('tunnel', { timestamp: 2, level: 'info', message: 'tunnel-1' });

		SharedLogStore.clear('api');

		expect(SharedLogStore.readAll('api')).toEqual([]);
		expect(SharedLogStore.readAll('tunnel')).toEqual([{ timestamp: 2, level: 'info', message: 'tunnel-1' }]);
	});

	it('keeps at most 500 entries per source', () => {
		for (let index = 0; index < 505; index += 1) {
			SharedLogStore.append('api', { timestamp: index, level: 'info', message: `api-${index}` });
		}

		const entries = SharedLogStore.readAll('api');

		expect(entries).toHaveLength(500);
		expect(entries[0]?.message).toBe('api-5');
		expect(entries.at(-1)?.message).toBe('api-504');
	});
});
