export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
	timestamp: number;
	level: LogLevel;
	message: string;
}

export type TunnelStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'error';

export interface TunnelState {
	status: TunnelStatus;
	url: string | null;
	error: string | null;
}

export type ApiStatus = 'stopped' | 'starting' | 'running' | 'error';

export type DashboardToHost =
	| { type: 'webview-ready' }
	| { type: 'restart-server' }
	| { type: 'start-tunnel' }
	| { type: 'stop-tunnel' }
	| { type: 'restart-tunnel' }
	| { type: 'open-external-url'; url: string }
	| { type: 'set-key-fix-enabled'; enabled: boolean }
	| { type: 'clear-logs'; source: 'api' | 'tunnel' };

export type HostToDashboard =
	| { type: 'port'; port: number | null }
	| { type: 'tunnel-status'; state: TunnelState }
	| { type: 'key-fix-state'; enabled: boolean }
	| { type: 'log'; source: 'api' | 'tunnel'; entry: LogEntry }
	| { type: 'log-bulk'; source: 'api' | 'tunnel'; entries: LogEntry[] }
	| { type: 'logs-cleared'; source: 'api' | 'tunnel' };
