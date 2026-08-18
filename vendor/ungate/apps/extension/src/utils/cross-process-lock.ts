import * as fs from 'node:fs';
import * as path from 'node:path';

import { sleep } from '@ungate/shared';

import { config } from '../runtime-state/config';

const PID_FILE = 'pid';

export class CrossProcessLock {
	static async acquire(lockName: string, timeoutMs = config.runtimeState.lockTimeoutMs): Promise<() => void> {
		const lockPath = path.join(config.baseDir, lockName);
		const startedAt = Date.now();

		while (true) {
			try {
				fs.mkdirSync(lockPath);
				fs.writeFileSync(path.join(lockPath, PID_FILE), String(process.pid), 'utf8');

				return () => {
					this.release(lockPath);
				};
			} catch (error: unknown) {
				const code = (error as NodeJS.ErrnoException | undefined)?.code;

				if (code !== 'EEXIST') {
					throw error;
				}

				if (Date.now() - startedAt > timeoutMs) {
					if (!this.isLockHolderAlive(lockPath)) {
						this.release(lockPath);
						continue;
					}
				}

				await sleep(10);
			}
		}
	}

	private static release(lockPath: string): void {
		try {
			fs.rmSync(path.join(lockPath, PID_FILE), { force: true });
			fs.rmdirSync(lockPath);
		} catch {}
	}

	private static isLockHolderAlive(lockPath: string): boolean {
		const pidPath = path.join(lockPath, PID_FILE);

		if (!fs.existsSync(pidPath)) {
			return false;
		}

		const raw = fs.readFileSync(pidPath, 'utf8').trim();
		const pid = Number.parseInt(raw, 10);

		if (!Number.isFinite(pid) || pid <= 0) {
			return false;
		}

		try {
			process.kill(pid, 0);

			return true;
		} catch {
			return false;
		}
	}
}
