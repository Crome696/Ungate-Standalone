import { postExtensionMessage } from '$shared/vscode';

import type { ExtensionToWebview, LogEntry } from '@ungate/shared/frontend';

const MAX_LOG_ENTRIES = 500;

interface LogsStore {
	readonly apiLogs: LogEntry[];
	readonly tunnelLogs: LogEntry[];
	clearApi(): void;
	clearTunnel(): void;
	copyApi(): Promise<void>;
	copyTunnel(): Promise<void>;
}

let apiLogs = $state<LogEntry[]>([]);
let tunnelLogs = $state<LogEntry[]>([]);

function handleMessage(event: MessageEvent): void {
	const message = event.data as ExtensionToWebview;

	if (message.type === 'log') {
		if (message.source === 'api') {
			apiLogs = trimLogEntries([...apiLogs, message.entry]);
		} else {
			tunnelLogs = trimLogEntries([...tunnelLogs, message.entry]);
		}
	}

	if (message.type === 'log-bulk') {
		if (message.source === 'api') {
			apiLogs = trimLogEntries([...apiLogs, ...message.entries]);
		} else {
			tunnelLogs = trimLogEntries([...tunnelLogs, ...message.entries]);
		}
	}

	if (message.type === 'logs-cleared') {
		if (message.source === 'api') {
			apiLogs = [];
		} else {
			tunnelLogs = [];
		}
	}
}

function trimLogEntries(entries: LogEntry[]): LogEntry[] {
	if (entries.length <= MAX_LOG_ENTRIES) {
		return entries;
	}

	return entries.slice(-MAX_LOG_ENTRIES);
}

window.addEventListener('message', handleMessage);

function clearApi(): void {
	apiLogs = [];
	postExtensionMessage({ type: 'clear-logs', source: 'api' });
}

function clearTunnel(): void {
	tunnelLogs = [];
	postExtensionMessage({ type: 'clear-logs', source: 'tunnel' });
}

async function copyApi(): Promise<void> {
	await navigator.clipboard.writeText(formatLogs(apiLogs));
}

async function copyTunnel(): Promise<void> {
	await navigator.clipboard.writeText(formatLogs(tunnelLogs));
}

function formatLogs(entries: LogEntry[]): string {
	return entries.map((entry) => `${new Date(entry.timestamp).toISOString()} [${entry.level}] ${entry.message}`).join('\n');
}

export function getLogsStore(): LogsStore {
	const store: LogsStore = {
		get apiLogs() {
			return apiLogs;
		},
		get tunnelLogs() {
			return tunnelLogs;
		},
		clearApi,
		clearTunnel,
		copyApi,
		copyTunnel
	};

	return store;
}
