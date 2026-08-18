import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BIN_DIR = path.join(os.homedir(), '.ungate', 'bin');
const SQLITE_TOOLS_VERSION = '3470200';
const SQLITE_YEAR = '2024';

type InstallLogger = (message: string) => void;

export class Sqlite3CliResolver {
	static async resolve(onLog?: InstallLogger): Promise<string | null> {
		const installedPath = this.getInstalledPath();

		if (fs.existsSync(installedPath)) {
			return installedPath;
		}

		const systemPath = await this.findOnPath();

		if (systemPath) {
			return systemPath;
		}

		return this.downloadAndInstall(onLog);
	}

	static getBinaryName(): string {
		return process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
	}

	static getInstalledPath(): string {
		return path.join(BIN_DIR, this.getBinaryName());
	}

	private static async findOnPath(): Promise<string | null> {
		const commands =
			process.platform === 'win32'
				? [
						['where.exe', ['sqlite3']],
						['where', ['sqlite3']]
					]
				: [['which', ['sqlite3']]];

		for (const [command, args] of commands) {
			try {
				const { stdout } = await execFileAsync(command, args);
				const candidate = stdout.trim().split(/\r?\n/)[0];

				if (candidate && fs.existsSync(candidate)) {
					return candidate;
				}
			} catch {
				continue;
			}
		}

		return null;
	}

	private static getDownloadUrl(): string | null {
		const { platform, arch } = process;

		if (platform === 'win32' && arch === 'x64') {
			return `https://www.sqlite.org/${SQLITE_YEAR}/sqlite-tools-win-x64-${SQLITE_TOOLS_VERSION}.zip`;
		}

		if (platform === 'darwin' && arch === 'arm64') {
			return `https://www.sqlite.org/${SQLITE_YEAR}/sqlite-tools-osx-aarch64-${SQLITE_TOOLS_VERSION}.zip`;
		}

		if (platform === 'darwin' && (arch === 'x64' || arch === 'x86_64')) {
			return `https://www.sqlite.org/${SQLITE_YEAR}/sqlite-tools-osx-x86-64-${SQLITE_TOOLS_VERSION}.zip`;
		}

		if (platform === 'linux' && arch === 'x64') {
			return `https://www.sqlite.org/${SQLITE_YEAR}/sqlite-tools-linux-x64-${SQLITE_TOOLS_VERSION}.zip`;
		}

		if (platform === 'linux' && arch === 'arm64') {
			return `https://www.sqlite.org/${SQLITE_YEAR}/sqlite-tools-linux-aarch64-${SQLITE_TOOLS_VERSION}.zip`;
		}

		return null;
	}

	private static async downloadAndInstall(onLog?: InstallLogger): Promise<string | null> {
		const url = this.getDownloadUrl();

		if (!url) {
			onLog?.(`SQLite CLI is not supported on ${process.platform}-${process.arch}`);

			return null;
		}

		const zipPath = path.join(os.tmpdir(), `ungate-sqlite3-${process.pid}-${Date.now()}.zip`);
		const extractDir = path.join(os.tmpdir(), `ungate-sqlite3-${process.pid}-${Date.now()}`);

		try {
			onLog?.('Downloading SQLite CLI...');
			fs.mkdirSync(BIN_DIR, { recursive: true });
			fs.mkdirSync(extractDir, { recursive: true });

			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			const zipBytes = Buffer.from(arrayBuffer);

			fs.writeFileSync(zipPath, zipBytes);
			await this.extractZip(zipPath, extractDir);

			const extractedBinary = this.findExtractedBinary(extractDir);

			if (!extractedBinary) {
				throw new Error('sqlite3 binary was not found in the downloaded archive');
			}

			fs.copyFileSync(extractedBinary, this.getInstalledPath());

			if (process.platform !== 'win32') {
				fs.chmodSync(this.getInstalledPath(), 0o755);
			}

			onLog?.('SQLite CLI installed');

			return this.getInstalledPath();
		} catch (error) {
			onLog?.(`Failed to install SQLite CLI: ${String(error)}`);

			return null;
		} finally {
			fs.rmSync(zipPath, { force: true });
			fs.rmSync(extractDir, { recursive: true, force: true });
		}
	}

	private static async extractZip(zipPath: string, destDir: string): Promise<void> {
		if (process.platform === 'win32') {
			await execFileAsync('powershell', [
				'-NoProfile',
				'-Command',
				`Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destDir)} -Force`
			]);

			return;
		}

		await execFileAsync('unzip', ['-o', zipPath, '-d', destDir]);
	}

	private static findExtractedBinary(rootDir: string): string | null {
		const binaryName = this.getBinaryName();
		const directPath = path.join(rootDir, binaryName);

		if (fs.existsSync(directPath)) {
			return directPath;
		}

		for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
			const entryPath = path.join(rootDir, entry.name);

			if (entry.isFile() && entry.name === binaryName) {
				return entryPath;
			}

			if (entry.isDirectory()) {
				const nested = this.findExtractedBinary(entryPath);

				if (nested) {
					return nested;
				}
			}
		}

		return null;
	}
}
