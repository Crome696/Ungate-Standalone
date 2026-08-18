import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import * as tar from 'tar';

import type { LogLevel } from './types.js';

const INSTALLED_BINARY_NAME = 'better_sqlite3.installed.node';

interface InstallCallbacks {
	onLog(level: LogLevel, message: string): void;
}

interface RuntimeInfo {
	abi: string;
	platform: string;
	arch: string;
}

export class BetterSqlite3Installer {
	static packageDir(apiDirectory: string): string {
		const nativeDir = path.join(apiDirectory, 'native', 'better-sqlite3');
		const nodeModulesDir = path.join(apiDirectory, 'node_modules', 'better-sqlite3');

		if (fs.existsSync(path.join(nativeDir, 'package.json'))) {
			return nativeDir;
		}

		return nodeModulesDir;
	}

	static readBundledVersion(apiDirectory: string): string {
		const packagePath = path.join(this.packageDir(apiDirectory), 'package.json');
		const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string };

		if (!pkg.version) {
			throw new Error('[native] better-sqlite3 package.json is missing version');
		}

		return pkg.version;
	}

	static getBinaryPath(apiDirectory: string): string {
		const sqliteDir = fs.realpathSync(this.packageDir(apiDirectory));

		return path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
	}

	static getInstalledBinaryPath(apiDirectory: string): string {
		return path.join(path.dirname(this.getBinaryPath(apiDirectory)), INSTALLED_BINARY_NAME);
	}

	static resolveBindingPath(apiDirectory: string): string {
		const installed = this.getInstalledBinaryPath(apiDirectory);

		if (fs.existsSync(installed)) {
			return installed;
		}

		return this.getBinaryPath(apiDirectory);
	}

	static inspectRuntime(runtime: string): RuntimeInfo {
		const result = spawnSync(
			runtime,
			['-p', 'JSON.stringify({ abi: process.versions.modules, platform: process.platform, arch: process.arch })'],
			{ encoding: 'utf8' }
		);

		if (result.error) {
			throw result.error;
		}

		if (result.status !== 0) {
			throw new Error(result.stderr.trim() || `Failed to inspect runtime: ${runtime}`);
		}

		return JSON.parse(result.stdout.trim()) as RuntimeInfo;
	}

	static async ensureInstalled(apiDirectory: string, runtime: string, callbacks: InstallCallbacks): Promise<void> {
		if (await this.canLoad(runtime, apiDirectory, callbacks)) {
			return;
		}

		await this.install(apiDirectory, runtime, callbacks);

		if (!(await this.canLoad(runtime, apiDirectory, callbacks))) {
			throw new Error('[native] better-sqlite3 prebuilt installation failed');
		}
	}

	private static async install(apiDirectory: string, runtime: string, callbacks: InstallCallbacks): Promise<void> {
		const binaryPath = this.getBinaryPath(apiDirectory);
		const installedBinaryPath = this.getInstalledBinaryPath(apiDirectory);
		const version = this.readBundledVersion(apiDirectory);
		const info = this.inspectRuntime(runtime);
		const tarName = `better-sqlite3-v${version}-node-v${info.abi}-${info.platform}-${info.arch}.tar.gz`;
		const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${tarName}`;

		callbacks.onLog('info', `[native] Using runtime: ${runtime}`);
		callbacks.onLog('info', `[native] Downloading ${tarName}...`);

		const stagingRoot = path.join(os.tmpdir(), `ungate-better-sqlite3-${process.pid}-${Date.now()}`);

		try {
			fs.mkdirSync(stagingRoot, { recursive: true });
			await this.downloadAndExtract(url, stagingRoot);
			const stagedBinary = path.join(stagingRoot, 'build', 'Release', 'better_sqlite3.node');

			if (!fs.existsSync(stagedBinary)) {
				throw new Error('[native] Downloaded archive did not contain better_sqlite3.node');
			}

			fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
			const tempTarget = `${installedBinaryPath}.${process.pid}.tmp`;
			fs.copyFileSync(stagedBinary, tempTarget);
			fs.renameSync(tempTarget, installedBinaryPath);
			callbacks.onLog('info', '[native] better-sqlite3 binary installed');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			if (message.includes('HTTP 404')) {
				throw new Error(`[native] No prebuilt better-sqlite3 binary for Node ABI ${info.abi} (${info.platform}-${info.arch}).`);
			}

			throw error;
		} finally {
			fs.rmSync(stagingRoot, { recursive: true, force: true });
		}
	}

	private static async downloadAndExtract(url: string, extractDir: string): Promise<void> {
		const response = await fetch(url, {
			headers: { 'User-Agent': 'ungate-standalone' }
		});

		if (!response.ok) {
			throw new Error(`Download failed: HTTP ${response.status}`);
		}

		if (!response.body) {
			throw new Error('Download failed: empty response body');
		}

		await pipeline(
			Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
			createGunzip(),
			tar.extract({ cwd: extractDir })
		);
	}

	private static async canLoad(runtime: string, apiDirectory: string, callbacks: InstallCallbacks): Promise<boolean> {
		const pathsToTry: string[] = [];
		const installedBinaryPath = this.getInstalledBinaryPath(apiDirectory);
		const defaultBinaryPath = this.getBinaryPath(apiDirectory);

		if (fs.existsSync(installedBinaryPath)) {
			pathsToTry.push(installedBinaryPath);
		}

		if (fs.existsSync(defaultBinaryPath) && defaultBinaryPath !== installedBinaryPath) {
			pathsToTry.push(defaultBinaryPath);
		}

		for (const bindingPath of pathsToTry) {
			if (await this.tryLoad(runtime, apiDirectory, bindingPath, callbacks)) {
				return true;
			}
		}

		return false;
	}

	private static tryLoad(
		runtime: string,
		apiDirectory: string,
		bindingPath: string,
		callbacks: InstallCallbacks
	): Promise<boolean> {
		const bindingLiteral = JSON.stringify(bindingPath);
		const script = `const Database=require('better-sqlite3'); const db=new Database(':memory:', { nativeBinding: ${bindingLiteral} }); db.pragma('journal_mode = WAL'); db.close();`;

		return new Promise((resolve) => {
			const child = spawn(runtime, ['-e', script], {
				cwd: apiDirectory,
				windowsHide: true,
				env: {
					...process.env,
					NODE_PATH: path.join(apiDirectory, 'native')
				}
			});
			let stderr = '';

			child.stderr?.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			child.on('exit', (code) => {
				if (code === 0) {
					resolve(true);

					return;
				}

				if (stderr.trim()) {
					callbacks.onLog('warn', `[native] ${stderr.trim()}`);
				}

				resolve(false);
			});

			child.on('error', () => {
				resolve(false);
			});
		});
	}
}
