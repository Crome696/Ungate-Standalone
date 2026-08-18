import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Sqlite3CliResolver } from './sqlite3-cli-resolver';

const execFileAsync = promisify(execFile);

export const SQLITE_CLI_UNAVAILABLE_REASON = 'SQLite CLI could not be prepared';

type InstallLogger = (message: string) => void;

export class CursorStateDbReader {
	private cliPath: string | null = null;
	private initResult: string | null | undefined;

	constructor(private readonly onLog?: InstallLogger) {}

	async init(): Promise<string | null> {
		if (this.initResult !== undefined) {
			return this.initResult;
		}

		this.cliPath = await Sqlite3CliResolver.resolve(this.onLog);
		this.initResult = this.cliPath ? null : SQLITE_CLI_UNAVAILABLE_REASON;

		return this.initResult;
	}

	async readItemTableValue(dbPath: string, key: string): Promise<string | null> {
		if (!this.cliPath) {
			return null;
		}

		const escapedKey = key.replaceAll("'", "''");
		const query = `SELECT value FROM ItemTable WHERE key = '${escapedKey}';`;
		const { stdout } = await execFileAsync(this.cliPath, [dbPath, query]);
		const raw = stdout.trim();

		return raw || null;
	}
}
