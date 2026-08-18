import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bin, install, Tunnel, use } from 'cloudflared';

import type { LogEntry, TunnelState } from './types.js';

const CLOUDFLARED_BIN_DIR = path.join(os.homedir(), '.ungate', 'bin');

function getCloudflaredBinPath(): string {
	return path.join(CLOUDFLARED_BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

function getCloudflaredLegacyBinPath(): string {
	return path.join(CLOUDFLARED_BIN_DIR, 'cloudflared');
}

function getCloudflaredConfigArg(): string {
	return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

export class TunnelManager {
	private tunnel: Tunnel | null = null;
	private state: TunnelState = { status: 'stopped', url: null, error: null };

	constructor(
		private readonly onStateChange: (state: TunnelState) => void,
		private readonly onLog: (entry: LogEntry) => void
	) {}

	getState(): TunnelState {
		return { ...this.state };
	}

	async start(port: number): Promise<void> {
		if (this.state.status === 'running') {
			return;
		}

		if (this.tunnel) {
			this.tunnel.stop();
			this.tunnel = null;
		}

		this.setState({ status: 'starting', url: null, error: null });
		await this.ensureBinary();

		if (this.state.status === 'error') {
			return;
		}

		this.spawnTunnel(port);
	}

	stop(): void {
		if (this.tunnel) {
			this.tunnel.stop();
			this.tunnel = null;
		}

		this.setState({ status: 'stopped', url: null, error: null });
	}

	async restart(port: number): Promise<void> {
		this.stop();
		await this.start(port);
	}

	private async ensureBinary(): Promise<void> {
		const devBinExists = fs.existsSync(bin);
		const userBinPath = this.resolveUserBinaryPath();

		if (devBinExists) {
			return;
		}

		if (userBinPath) {
			use(userBinPath);

			return;
		}

		this.setState({ status: 'installing', url: null, error: null });
		this.onLog({ timestamp: Date.now(), level: 'info', message: 'Downloading cloudflared binary...' });

		try {
			fs.mkdirSync(CLOUDFLARED_BIN_DIR, { recursive: true });
			const installPath = getCloudflaredBinPath();
			const installedPath = await install(installPath);
			use(installedPath);
			this.onLog({ timestamp: Date.now(), level: 'info', message: 'cloudflared installed successfully' });
			this.setState({ status: 'starting', url: null, error: null });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.onLog({ timestamp: Date.now(), level: 'error', message: `Failed to install cloudflared: ${message}` });
			this.setState({ status: 'error', url: null, error: `Install failed: ${message}` });
		}
	}

	private resolveUserBinaryPath(): string | null {
		const binPath = getCloudflaredBinPath();

		if (fs.existsSync(binPath)) {
			return binPath;
		}

		const legacyPath = getCloudflaredLegacyBinPath();

		if (process.platform === 'win32' && fs.existsSync(legacyPath)) {
			fs.renameSync(legacyPath, binPath);

			return binPath;
		}

		return null;
	}

	private spawnTunnel(port: number): void {
		const tunnel = Tunnel.quick(`http://127.0.0.1:${port}`, {
			'--config': getCloudflaredConfigArg(),
			'--edge-ip-version': '4'
		});
		this.tunnel = tunnel;

		tunnel.on('url', (url) => {
			this.onLog({ timestamp: Date.now(), level: 'info', message: `Tunnel URL: ${url}` });
			this.setState({ status: 'running', url, error: null });
		});

		tunnel.on('stderr', (data) => {
			const lines = data.split('\n').filter((line) => line.trim());

			for (const line of lines) {
				this.onLog({ timestamp: Date.now(), level: 'info', message: line });
			}
		});

		tunnel.on('error', (error) => {
			const message = error.message;
			this.onLog({ timestamp: Date.now(), level: 'error', message: `Tunnel error: ${message}` });
			this.setState({ status: 'error', url: null, error: message });
		});

		tunnel.on('exit', (code, signal) => {
			this.onLog({
				timestamp: Date.now(),
				level: 'warn',
				message: `Tunnel exited code=${code} signal=${signal}`
			});

			const wasStarting = this.state.status === 'starting';

			if (this.state.status !== 'stopped') {
				const next: TunnelState = wasStarting
					? { status: 'error', url: null, error: `Process exited before tunnel was ready (code=${code})` }
					: { status: 'stopped', url: null, error: null };

				this.setState(next);
			}

			this.tunnel = null;
		});
	}

	private setState(next: TunnelState): void {
		this.state = next;
		this.onStateChange(next);
	}
}
