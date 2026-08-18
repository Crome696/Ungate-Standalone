import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { apiDir, nodeBinaryPath } from './paths.js';
import { BetterSqlite3Installer } from './sqlite-installer.js';

import type { ApiStatus, LogLevel } from './types.js';

const HEALTH_URL = (port: number): string => `http://127.0.0.1:${port}/health`;
const DEFAULT_PORT = 47821;

export interface ApiProcessCallbacks {
	onLog(level: LogLevel, message: string): void;
	onPortDetected(port: number): void;
	onStatusChange(status: ApiStatus): void;
}

export class ApiProcess {
	private child: ChildProcess | null = null;
	private stdoutBuffer = '';
	private port: number | null = null;
	private healthTimer: NodeJS.Timeout | null = null;
	private restartRequested = false;
	private stopping = false;

	constructor(private readonly callbacks: ApiProcessCallbacks) {}

	getPort(): number | null {
		return this.port;
	}

	async start(): Promise<void> {
		if (this.child) {
			return;
		}

		const existingPort = await this.findHealthyPort();

		if (existingPort) {
			this.port = existingPort;
			this.callbacks.onPortDetected(existingPort);
			this.callbacks.onStatusChange('running');
			this.startHealthCheck();
			this.callbacks.onLog('info', `[process] attached to existing API on port ${existingPort}`);

			return;
		}

		this.callbacks.onStatusChange('starting');
		const cwd = apiDir();
		const runtime = nodeBinaryPath();

		await BetterSqlite3Installer.ensureInstalled(cwd, runtime, {
			onLog: (level, message) => this.callbacks.onLog(level, message)
		});

		const env: NodeJS.ProcessEnv = {
			...process.env,
			NODE_PATH: path.join(cwd, 'native'),
			UNGATE_BETTER_SQLITE3_NATIVE_BINDING: BetterSqlite3Installer.resolveBindingPath(cwd),
			DRIZZLE_PATH: path.join(cwd, 'drizzle')
		};

		this.stdoutBuffer = '';
		this.callbacks.onLog('info', `[process] starting api via ${runtime}`);
		this.child = spawn(runtime, ['bundle/main.cjs'], {
			cwd,
			env,
			stdio: 'pipe',
			windowsHide: true
		});

		this.child.stdout?.on('data', (data: Buffer) => this.onStdout(data));
		this.child.stderr?.on('data', (data: Buffer) => this.onStderr(data));
		this.child.on('exit', (code, signal) => this.onExit(code, signal));
		this.child.on('error', (error) => {
			this.callbacks.onLog('error', `[process] error: ${error.message}`);
			this.callbacks.onStatusChange('error');
		});

		this.startHealthCheck();
	}

	async restart(): Promise<void> {
		this.restartRequested = true;
		this.port = null;
		this.callbacks.onStatusChange('stopped');

		if (!this.child) {
			this.restartRequested = false;
			await this.start();

			return;
		}

		this.killChild();
	}

	stop(): Promise<void> {
		this.stopping = true;
		this.stopHealthCheck();
		this.killChild();
		this.child = null;
		this.port = null;
		this.callbacks.onStatusChange('stopped');

		return Promise.resolve();
	}

	private killChild(): void {
		if (!this.child?.pid) {
			this.child = null;

			return;
		}

		if (process.platform === 'win32') {
			spawn('taskkill', ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
		} else {
			this.child.kill('SIGTERM');
		}

		this.child = null;
	}

	private onStdout(data: Buffer): void {
		const text = data.toString();
		this.stdoutBuffer += text;

		for (const line of text.split('\n').filter((item) => item.trim())) {
			this.callbacks.onLog(this.parseLogLevel(line), line);
		}

		const match = /localhost:(\d+)/.exec(this.stdoutBuffer);

		if (match) {
			const port = Number.parseInt(match[1], 10);

			if (port !== this.port) {
				this.port = port;
				this.callbacks.onPortDetected(port);
			}
		}
	}

	private onStderr(data: Buffer): void {
		const text = data.toString();

		for (const line of text.split('\n').filter((item) => item.trim())) {
			this.callbacks.onLog('error', line);
		}
	}

	private onExit(code: number | null, signal: NodeJS.Signals | null): void {
		this.child = null;
		this.callbacks.onLog(code === 0 || this.restartRequested ? 'info' : 'error', `[process] exit code=${code} signal=${signal}`);

		if (this.stopping) {
			this.stopping = false;

			return;
		}

		if (this.restartRequested) {
			this.restartRequested = false;
			void this.start();

			return;
		}

		if (code !== 0) {
			this.callbacks.onStatusChange('error');
		}
	}

	private startHealthCheck(): void {
		this.stopHealthCheck();
		this.healthTimer = setInterval(() => {
			void this.checkHealth();
		}, 2000);
	}

	private stopHealthCheck(): void {
		if (this.healthTimer) {
			clearInterval(this.healthTimer);
			this.healthTimer = null;
		}
	}

	private async checkHealth(): Promise<void> {
		if (!this.port) {
			return;
		}

		const healthy = await this.isPortHealthy(this.port);

		if (healthy) {
			this.callbacks.onStatusChange('running');

			return;
		}

		this.callbacks.onStatusChange('error');
		this.callbacks.onLog('error', `[process] health check failed on port ${this.port}`);
	}

	private async findHealthyPort(): Promise<number | null> {
		const candidates = new Set<number>([DEFAULT_PORT]);

		if (process.env.PORT) {
			const parsed = Number.parseInt(process.env.PORT, 10);

			if (!Number.isNaN(parsed)) {
				candidates.add(parsed);
			}
		}

		for (const port of candidates) {
			if (await this.isPortHealthy(port)) {
				return port;
			}
		}

		return null;
	}

	private async isPortHealthy(port: number): Promise<boolean> {
		try {
			const response = await fetch(HEALTH_URL(port), { signal: AbortSignal.timeout(1500) });

			return response.ok;
		} catch {
			return false;
		}
	}

	private parseLogLevel(line: string): LogLevel {
		const lower = line.toLowerCase();

		if (lower.includes('error') || lower.includes('fatal')) {
			return 'error';
		}

		if (lower.includes('warn')) {
			return 'warn';
		}

		return 'info';
	}
}
