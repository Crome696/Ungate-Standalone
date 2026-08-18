import * as fs from 'node:fs';

import { config } from './config';

import type { LogEntry } from '@ungate/shared/frontend';

const MAX_LOG_ENTRIES_PER_SOURCE = 500;
const sharedLogPath = config.paths.sharedLogPath;

interface SharedLogRecord {
	source: 'api' | 'tunnel';
	entry: LogEntry;
}

export class SharedLogStore {
	public static append(source: 'api' | 'tunnel', entry: LogEntry): void {
		this.ensureDirectory();
		const record: SharedLogRecord = { source, entry };
		fs.appendFileSync(sharedLogPath, `${JSON.stringify(record)}\n`, 'utf8');
		this.trimIfNeeded();
	}

	public static clear(source: 'api' | 'tunnel'): void {
		this.ensureDirectory();

		if (!fs.existsSync(sharedLogPath)) {
			return;
		}

		const records = this.readAllRecords();
		const kept = records.filter((record) => record.source !== source);

		this.writeRecords(kept);
	}

	public static readAll(source: 'api' | 'tunnel'): LogEntry[] {
		return this.readFromDisk(source);
	}

	public static getFileSize(): number {
		this.ensureDirectory();

		if (!fs.existsSync(sharedLogPath)) {
			return 0;
		}

		return fs.statSync(sharedLogPath).size;
	}

	public static readSince(source: 'api' | 'tunnel', byteOffset: number): { entries: LogEntry[]; nextOffset: number } {
		this.ensureDirectory();

		if (!fs.existsSync(sharedLogPath)) {
			return { entries: [], nextOffset: byteOffset };
		}

		const stat = fs.statSync(sharedLogPath);
		const nextOffset = stat.size;

		if (stat.size <= byteOffset) {
			return { entries: [], nextOffset: byteOffset };
		}

		const length = nextOffset - byteOffset;
		const buffer = Buffer.alloc(length);
		const fd = fs.openSync(sharedLogPath, 'r');

		try {
			fs.readSync(fd, buffer, 0, length, byteOffset);
		} finally {
			fs.closeSync(fd);
		}

		const entries = this.parseContent(source, buffer.toString('utf8'));

		return { entries, nextOffset };
	}

	private static readFromDisk(source: 'api' | 'tunnel'): LogEntry[] {
		this.ensureDirectory();

		if (!fs.existsSync(sharedLogPath)) {
			return [];
		}

		const content = fs.readFileSync(sharedLogPath, 'utf8');

		return this.parseContent(source, content);
	}

	private static parseContent(source: 'api' | 'tunnel', content: string): LogEntry[] {
		const entries: LogEntry[] = [];
		const lines = content.split('\n').filter((line) => line.trim());

		for (const line of lines) {
			try {
				const record = JSON.parse(line) as SharedLogRecord;

				if (record.source === source) {
					entries.push(record.entry);
				}
			} catch {}
		}

		return entries;
	}

	private static readAllRecords(): SharedLogRecord[] {
		this.ensureDirectory();

		if (!fs.existsSync(sharedLogPath)) {
			return [];
		}

		const content = fs.readFileSync(sharedLogPath, 'utf8');
		const records: SharedLogRecord[] = [];
		const lines = content.split('\n').filter((line) => line.trim());

		for (const line of lines) {
			try {
				records.push(JSON.parse(line) as SharedLogRecord);
			} catch {}
		}

		return records;
	}

	private static writeRecords(records: SharedLogRecord[]): void {
		const content = records.map((record) => JSON.stringify(record)).join('\n');

		fs.writeFileSync(sharedLogPath, content ? `${content}\n` : '', 'utf8');
	}

	private static trimIfNeeded(): void {
		const records = this.readAllRecords();
		const api = records.filter((record) => record.source === 'api');
		const tunnel = records.filter((record) => record.source === 'tunnel');
		const nextApi = api.length > MAX_LOG_ENTRIES_PER_SOURCE ? api.slice(-MAX_LOG_ENTRIES_PER_SOURCE) : api;
		const nextTunnel = tunnel.length > MAX_LOG_ENTRIES_PER_SOURCE ? tunnel.slice(-MAX_LOG_ENTRIES_PER_SOURCE) : tunnel;

		if (nextApi.length === api.length && nextTunnel.length === tunnel.length) {
			return;
		}

		const merged = [...nextApi, ...nextTunnel].sort((left, right) => left.entry.timestamp - right.entry.timestamp);

		this.writeRecords(merged);
	}

	private static ensureDirectory(): void {
		fs.mkdirSync(config.baseDir, { recursive: true });
	}
}
