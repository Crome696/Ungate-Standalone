import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

import * as tar from 'tar';

const NODE_VERSION = '22.16.0';
// Node 22 ships MODULES ABI 127. Keep this in lockstep with NODE_VERSION.
const NODE_ABI = '127';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNGATE_DIR = path.join(ROOT, 'vendor', 'ungate');
const RESOURCES_DIR = path.join(ROOT, 'resources');
const RUNTIME_DIR = path.join(RESOURCES_DIR, 'runtime');
const RUNTIMES_DIR = path.join(RESOURCES_DIR, 'runtimes');
const NATIVE_CACHE_DIR = path.join(RESOURCES_DIR, 'native-cache');
const API_DIR = path.join(RESOURCES_DIR, 'api');
const WEB_DIR = path.join(RESOURCES_DIR, 'web');

const RUNTIME_TARGETS = [
	{ platform: 'win32', arch: 'x64' },
	{ platform: 'darwin', arch: 'x64' },
	{ platform: 'darwin', arch: 'arm64' },
	{ platform: 'linux', arch: 'x64' },
	{ platform: 'linux', arch: 'arm64' }
];

function log(message) {
	console.log(message);
}

function nodeBinaryName(platform) {
	return platform === 'win32' ? 'node.exe' : 'node';
}

function targetKey(platform, arch) {
	return `${platform}-${arch}`;
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		env: { ...process.env, HUSKY: '0' },
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
	}
}

async function fetchResponse(url) {
	log(`Downloading ${url}`);
	const response = await fetch(url, { headers: { 'User-Agent': 'ungate-standalone' } });

	if (!response.ok || !response.body) {
		throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
	}

	return response;
}

async function download(url, destination) {
	const response = await fetchResponse(url);
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function extractGzipTar(url, destination) {
	const response = await fetchResponse(url);
	fs.mkdirSync(destination, { recursive: true });
	await pipeline(Readable.fromWeb(response.body), createGunzip(), tar.extract({ cwd: destination }));
}

function copyDir(source, destination) {
	fs.cpSync(source, destination, { recursive: true, dereference: true, force: true });
}

function copyPackage(fromDir, packageName, destinationRoot) {
	const packageJsonPath = createRequire(path.join(fromDir, 'package.json')).resolve(`${packageName}/package.json`);
	copyDir(path.dirname(packageJsonPath), path.join(destinationRoot, packageName));
}

function findExtractedFile(root, fileName) {
	const stack = [root];

	while (stack.length > 0) {
		const current = stack.pop();

		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);

			if (entry.isDirectory()) {
				stack.push(fullPath);
			} else if (entry.name === fileName) {
				return fullPath;
			}
		}
	}

	return null;
}

function nodeDownloadSpec(platform, arch) {
	if (platform === 'win32' && arch === 'x64') {
		return {
			url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
			kind: 'file'
		};
	}

	if ((platform === 'darwin' || platform === 'linux') && (arch === 'x64' || arch === 'arm64')) {
		return {
			url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platform}-${arch}.tar.gz`,
			kind: 'archive'
		};
	}

	throw new Error(`Unsupported Node runtime target ${platform}-${arch}`);
}

async function downloadRuntime(platform, arch) {
	const destinationDir = path.join(RUNTIMES_DIR, targetKey(platform, arch));
	const destination = path.join(destinationDir, nodeBinaryName(platform));

	if (fs.existsSync(destination)) {
		log(`Skipping existing Node runtime ${targetKey(platform, arch)}`);

		return destination;
	}

	const spec = nodeDownloadSpec(platform, arch);
	fs.mkdirSync(destinationDir, { recursive: true });

	if (spec.kind === 'file') {
		await download(spec.url, destination);

		return destination;
	}

	const stagingRoot = path.join(os.tmpdir(), `ungate-node-${platform}-${arch}-${process.pid}`);
	fs.rmSync(stagingRoot, { recursive: true, force: true });
	fs.mkdirSync(stagingRoot, { recursive: true });

	try {
		await extractGzipTar(spec.url, stagingRoot);
		const extracted = findExtractedFile(stagingRoot, 'node');

		if (!extracted) {
			throw new Error(`Node archive for ${targetKey(platform, arch)} did not contain bin/node`);
		}

		fs.copyFileSync(extracted, destination);

		if (process.platform !== 'win32') {
			fs.chmodSync(destination, 0o755);
		}
	} finally {
		fs.rmSync(stagingRoot, { recursive: true, force: true });
	}

	return destination;
}

async function downloadRuntimes() {
	for (const target of RUNTIME_TARGETS) {
		await downloadRuntime(target.platform, target.arch);
	}
}

function stageHostRuntime() {
	const hostKey = targetKey(process.platform, process.arch);
	const source = path.join(RUNTIMES_DIR, hostKey, nodeBinaryName(process.platform));

	if (!fs.existsSync(source)) {
		const supported = RUNTIME_TARGETS.map((item) => targetKey(item.platform, item.arch)).join(', ');
		throw new Error(`No staged Node runtime for host ${hostKey}. Supported targets: ${supported}.`);
	}

	fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
	fs.mkdirSync(RUNTIME_DIR, { recursive: true });
	const destination = path.join(RUNTIME_DIR, nodeBinaryName(process.platform));
	fs.copyFileSync(source, destination);

	if (process.platform !== 'win32') {
		fs.chmodSync(destination, 0o755);
	}

	log(`Staged host runtime ${hostKey} -> resources/runtime/`);
}

async function downloadBetterSqlite3Prebuilds(version) {
	const cacheRoot = path.join(NATIVE_CACHE_DIR, `better-sqlite3-v${version}-node-v${NODE_ABI}`);

	for (const target of RUNTIME_TARGETS) {
		const cacheDir = path.join(cacheRoot, targetKey(target.platform, target.arch));
		const cacheFile = path.join(cacheDir, 'better_sqlite3.node');

		if (fs.existsSync(cacheFile)) {
			log(`Skipping existing better-sqlite3 ${targetKey(target.platform, target.arch)}`);
			continue;
		}

		const tarName = `better-sqlite3-v${version}-node-v${NODE_ABI}-${target.platform}-${target.arch}.tar.gz`;
		const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${tarName}`;
		const stagingRoot = path.join(os.tmpdir(), `ungate-sqlite-${target.platform}-${target.arch}-${process.pid}`);
		fs.rmSync(stagingRoot, { recursive: true, force: true });
		fs.mkdirSync(stagingRoot, { recursive: true });

		try {
			await extractGzipTar(url, stagingRoot);
			const stagedBinary = findExtractedFile(stagingRoot, 'better_sqlite3.node');

			if (!stagedBinary) {
				throw new Error(`Downloaded ${tarName} did not contain better_sqlite3.node`);
			}

			fs.mkdirSync(cacheDir, { recursive: true });
			fs.copyFileSync(stagedBinary, cacheFile);
			log(`Cached better-sqlite3 ${targetKey(target.platform, target.arch)}`);
		} finally {
			fs.rmSync(stagingRoot, { recursive: true, force: true });
		}
	}

	return cacheRoot;
}

function stageBetterSqlite3Prebuilds(cacheRoot) {
	const sqliteRoot = path.join(API_DIR, 'native', 'better-sqlite3');

	for (const target of RUNTIME_TARGETS) {
		const source = path.join(cacheRoot, targetKey(target.platform, target.arch), 'better_sqlite3.node');

		if (!fs.existsSync(source)) {
			throw new Error(`Missing cached better-sqlite3 binary for ${targetKey(target.platform, target.arch)}`);
		}

		const destinationDir = path.join(sqliteRoot, 'prebuilds', targetKey(target.platform, target.arch));
		fs.mkdirSync(destinationDir, { recursive: true });
		fs.copyFileSync(source, path.join(destinationDir, 'better_sqlite3.node'));
	}

	const hostPrebuild = path.join(sqliteRoot, 'prebuilds', targetKey(process.platform, process.arch), 'better_sqlite3.node');

	if (!fs.existsSync(hostPrebuild)) {
		throw new Error(`No better-sqlite3 prebuild for host ${targetKey(process.platform, process.arch)}`);
	}

	const releaseDir = path.join(sqliteRoot, 'build', 'Release');
	fs.mkdirSync(releaseDir, { recursive: true });
	fs.copyFileSync(hostPrebuild, path.join(releaseDir, 'better_sqlite3.node'));
	fs.copyFileSync(hostPrebuild, path.join(releaseDir, 'better_sqlite3.installed.node'));
	log(`Installed host better-sqlite3 native binary (${targetKey(process.platform, process.arch)})`);
}

function assembleApi(apiSourceDir) {
	fs.rmSync(API_DIR, { recursive: true, force: true });
	fs.mkdirSync(path.join(API_DIR, 'bundle'), { recursive: true });
	fs.mkdirSync(path.join(API_DIR, 'native'), { recursive: true });
	copyDir(path.join(apiSourceDir, 'bundle'), path.join(API_DIR, 'bundle'));
	copyDir(path.join(apiSourceDir, 'drizzle'), path.join(API_DIR, 'drizzle'));
	copyPackage(apiSourceDir, 'better-sqlite3', path.join(API_DIR, 'native'));

	try {
		copyPackage(apiSourceDir, 'bindings', path.join(API_DIR, 'native'));
	} catch {
		log('Optional bindings package not found; continuing');
	}

	try {
		copyPackage(apiSourceDir, 'file-uri-to-path', path.join(API_DIR, 'native'));
	} catch {
		log('Optional file-uri-to-path package not found; continuing');
	}

	fs.rmSync(path.join(API_DIR, 'native', 'better-sqlite3', 'build'), { recursive: true, force: true });
	fs.rmSync(path.join(API_DIR, 'native', 'better-sqlite3', 'deps'), { recursive: true, force: true });
}

function assembleWeb() {
	fs.rmSync(WEB_DIR, { recursive: true, force: true });
	fs.mkdirSync(WEB_DIR, { recursive: true });
	copyDir(path.join(UNGATE_DIR, 'apps', 'web', 'dist'), path.join(WEB_DIR, 'dist'));
}

function copyIcon() {
	const source = path.join(UNGATE_DIR, 'apps', 'extension', 'resources', 'icon.png');
	fs.mkdirSync(RESOURCES_DIR, { recursive: true });
	fs.copyFileSync(source, path.join(RESOURCES_DIR, 'icon.png'));
}

async function main() {
	if (!fs.existsSync(UNGATE_DIR)) {
		throw new Error('vendor/ungate is missing. Initialize the Git submodule first.');
	}

	log('Installing Ungate workspace dependencies...');
	run('pnpm', ['install'], UNGATE_DIR);

	log('Building @ungate/shared...');
	run('pnpm', ['--filter', '@ungate/shared', 'exec', 'tsup'], UNGATE_DIR);

	log('Building @ungate/api bundle...');
	run('pnpm', ['--filter', '@ungate/api', 'run', 'build:bundle'], UNGATE_DIR);

	log('Building @ungate/web...');
	run('pnpm', ['--filter', '@ungate/web', 'run', 'build'], UNGATE_DIR);

	const apiSourceDir = path.join(UNGATE_DIR, 'apps', 'api');
	assembleApi(apiSourceDir);
	assembleWeb();
	copyIcon();
	await downloadRuntimes();
	stageHostRuntime();

	const sqliteVersion = JSON.parse(
		fs.readFileSync(path.join(API_DIR, 'native', 'better-sqlite3', 'package.json'), 'utf8')
	).version;
	const sqliteCacheRoot = await downloadBetterSqlite3Prebuilds(sqliteVersion);
	stageBetterSqlite3Prebuilds(sqliteCacheRoot);

	log('Resources ready in resources/');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
