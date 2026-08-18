import { BrowserWindow, ipcMain, shell } from 'electron';

import { ApiProcess } from './api-process.js';
import { DashboardServer, loadingPageUrl } from './dashboard-server.js';
import { LogRingBuffer } from './log-ring-buffer.js';
import { iconPath, preloadPath } from './paths.js';
import { TunnelManager } from './tunnel-manager.js';

import type { DashboardToHost, HostToDashboard, LogEntry, LogLevel, TunnelState } from './types.js';

const LOG_BUFFER_SIZE = 500;

export class HostController {
	private window: BrowserWindow | null = null;
	private readonly dashboard = new DashboardServer();
	private readonly apiLogs = new LogRingBuffer(LOG_BUFFER_SIZE);
	private readonly tunnelLogs = new LogRingBuffer(LOG_BUFFER_SIZE);
	private currentPort: number | null = null;
	private currentTunnelState: TunnelState = { status: 'stopped', url: null, error: null };
	private readonly api: ApiProcess;
	private readonly tunnel: TunnelManager;

	constructor() {
		this.api = new ApiProcess({
			onLog: (level, message) => this.pushLog('api', level, message),
			onPortDetected: (port) => this.handlePortDetected(port),
			onStatusChange: (status) => {
				this.pushLog('api', 'info', `[status] ${status}`);
			}
		});

		this.tunnel = new TunnelManager(
			(state) => {
				this.currentTunnelState = state;
				this.sendToDashboard({ type: 'tunnel-status', state });
			},
			(entry) => this.pushLog('tunnel', entry.level, entry.message)
		);
	}

	async start(): Promise<void> {
		ipcMain.on('dashboard:message', (_event, message: unknown) => {
			this.handleDashboardMessage(this.parseMessage(message));
		});

		this.createWindow();
		void this.window?.loadURL(loadingPageUrl('Starting Ungate API...'));

		try {
			await this.dashboard.start();
			await this.api.start();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.pushLog('api', 'error', message);
			void this.window?.loadURL(loadingPageUrl(`Failed to start Ungate: ${message}`));
		}
	}

	async stop(): Promise<void> {
		this.tunnel.stop();
		await this.api.stop();
		await this.dashboard.stop();
		this.window?.destroy();
		this.window = null;
	}

	private createWindow(): void {
		this.window = new BrowserWindow({
			width: 1100,
			height: 780,
			minWidth: 800,
			minHeight: 600,
			title: 'Ungate',
			autoHideMenuBar: true,
			icon: iconPath(),
			webPreferences: {
				preload: preloadPath(),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false
			}
		});

		this.window.on('closed', () => {
			this.window = null;
		});
	}

	private handlePortDetected(port: number): void {
		const isNew = this.currentPort !== port;
		this.currentPort = port;
		this.dashboard.setApiPort(port);
		this.sendToDashboard({ type: 'port', port });

		if (isNew) {
			this.pushLog('api', 'info', `[port] detected: ${port}`);
			void this.window?.loadURL(this.dashboard.url());
		}

		if (this.currentTunnelState.status === 'running') {
			void this.tunnel.restart(port).catch((error: unknown) => {
				this.reportTunnelError(error);
			});
		}
	}

	private handleDashboardMessage(message: DashboardToHost | null): void {
		if (!message) {
			return;
		}

		if (message.type === 'webview-ready') {
			this.sendToDashboard({ type: 'port', port: this.currentPort });
			this.sendToDashboard({ type: 'tunnel-status', state: this.currentTunnelState });
			this.sendToDashboard({ type: 'key-fix-state', enabled: false });
			this.sendToDashboard({ type: 'log-bulk', source: 'api', entries: this.apiLogs.getAll() });
			this.sendToDashboard({ type: 'log-bulk', source: 'tunnel', entries: this.tunnelLogs.getAll() });

			return;
		}

		if (message.type === 'open-external-url') {
			void shell.openExternal(message.url);

			return;
		}

		if (message.type === 'restart-server') {
			void this.api.restart();

			return;
		}

		if (message.type === 'start-tunnel') {
			this.startTunnel();

			return;
		}

		if (message.type === 'stop-tunnel') {
			this.tunnel.stop();

			return;
		}

		if (message.type === 'restart-tunnel') {
			this.restartTunnel();

			return;
		}

		if (message.type === 'set-key-fix-enabled') {
			this.sendToDashboard({ type: 'key-fix-state', enabled: false });
			this.pushLog(
				'api',
				'warn',
				'OpenAI Key Fix is not available in the standalone app. Enable OpenAI API Key in Cursor Settings yourself.'
			);

			return;
		}

		if (message.type === 'clear-logs') {
			const buffer = message.source === 'api' ? this.apiLogs : this.tunnelLogs;
			buffer.clear();
			this.sendToDashboard({ type: 'logs-cleared', source: message.source });
		}
	}

	private startTunnel(): void {
		if (!this.currentPort) {
			this.pushLog('tunnel', 'error', 'Cannot start tunnel: API not running');

			return;
		}

		this.pushLog('tunnel', 'info', `start requested on port ${this.currentPort}`);
		void this.tunnel.start(this.currentPort).catch((error: unknown) => this.reportTunnelError(error));
	}

	private restartTunnel(): void {
		if (!this.currentPort) {
			return;
		}

		void this.tunnel.restart(this.currentPort).catch((error: unknown) => this.reportTunnelError(error));
	}

	private reportTunnelError(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.pushLog('tunnel', 'error', `Tunnel failed: ${message}`);
	}

	private pushLog(source: 'api' | 'tunnel', level: LogLevel, message: string): void {
		const entry: LogEntry = { timestamp: Date.now(), level, message };
		const buffer = source === 'api' ? this.apiLogs : this.tunnelLogs;
		buffer.push(entry);
		this.sendToDashboard({ type: 'log', source, entry });
	}

	private sendToDashboard(message: HostToDashboard): void {
		this.window?.webContents.send('dashboard:event', message);
	}

	private parseMessage(raw: unknown): DashboardToHost | null {
		if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
			return null;
		}

		const record = raw as Record<string, unknown>;
		const type = record.type;

		if (type === 'open-external-url' && typeof record.url === 'string') {
			return { type, url: record.url };
		}

		if (type === 'set-key-fix-enabled' && typeof record.enabled === 'boolean') {
			return { type, enabled: record.enabled };
		}

		if (type === 'clear-logs' && (record.source === 'api' || record.source === 'tunnel')) {
			return { type, source: record.source };
		}

		if (
			type === 'webview-ready' ||
			type === 'restart-server' ||
			type === 'start-tunnel' ||
			type === 'stop-tunnel' ||
			type === 'restart-tunnel'
		) {
			return { type };
		}

		return null;
	}
}
