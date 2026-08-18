import type { LogLevel } from './runtime';

export interface LogEntry {
	timestamp: number;
	level: LogLevel;
	message: string;
}
