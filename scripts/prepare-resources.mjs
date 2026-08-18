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
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNGATE_DIR = path.join(ROOT, 'vendor', 'ungate');
const RESOURCES_DIR = path.join(ROOT, 'resources');
const RUNTIME_DIR = path.join(RESOURCES_DIR, 'runtime');
const API_DIR = path.join(RESOURCES_DIR, 'api');
const WEB_DIR = path.join(RESOURCES_DIR, 'web');

function log(message) {
	console.log(message);
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

async function download(url, destination) {
	log(`Downloading ${url}`);
	const response = await fetch(url, { headers: { 'User-Agent': 'ungate-standalone' } });

	if (!response.ok || !response.body) {
		throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
	}

	fs.mkdirSync(path.dirname(destination), { recursive: true });
	await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function copyDir(source, destination) {
	fs.cpSync(source, destination, { recursive: true, dereference: true, force: true });
}

function copyPackage(fromDir, packageName, destinationRoot) {
	const packageJsonPath = createRequire(path.join(fromDir, 'package.json')).resolve(`${packageName}/package.json`);
	copyDir(path.dirname(packageJsonPath), path.join(destinationRoot, packageName));
}

async function downloadNode() {
	fs.mkdirSync(RUNTIME_DIR, { recursive: true });
	const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
	const destination = path.join(RUNTIME_DIR, nodeName);

	if (process.platform !== 'win32') {
		throw new Error('This packager currently supports Windows x64 only.');
	}

	await download(`https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`, destination);
}

function inspectNode(runtime) {
	const result = spawnSync(
		runtime,
		['-p', 'JSON.stringify({ abi: process.versions.modules, platform: process.platform, arch: process.arch })'],
		{ encoding: 'utf8' }
	);

	if (result.status !== 0) {
		throw new Error(result.stderr || 'Failed to inspect bundled Node');
	}

	return JSON.parse(result.stdout.trim());
}

async function installBetterSqlite3(runtime) {
	const version = JSON.parse(fs.readFileSync(path.join(API_DIR, 'native', 'better-sqlite3', 'package.json'), 'utf8')).version;
	const info = inspectNode(runtime);
	const tarName = `better-sqlite3-v${version}-node-v${info.abi}-${info.platform}-${info.arch}.tar.gz`;
	const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${tarName}`;
	const stagingRoot = path.join(os.tmpdir(), `ungate-sqlite-${process.pid}`);

	fs.rmSync(stagingRoot, { recursive: true, force: true });
	fs.mkdirSync(stagingRoot, { recursive: true });

	log(`Downloading ${tarName}`);
	const response = await fetch(url, { headers: { 'User-Agent': 'ungate-standalone' } });

	if (!response.ok || !response.body) {
		throw new Error(`better-sqlite3 download failed: HTTP ${response.status}`);
	}

	await pipeline(Readable.fromWeb(response.body), createGunzip(), tar.extract({ cwd: stagingRoot }));
	const stagedBinary = path.join(stagingRoot, 'build', 'Release', 'better_sqlite3.node');

	if (!fs.existsSync(stagedBinary)) {
		throw new Error('Downloaded better-sqlite3 archive did not contain the native binary');
	}

	const releaseDir = path.join(API_DIR, 'native', 'better-sqlite3', 'build', 'Release');
	fs.mkdirSync(releaseDir, { recursive: true });
	fs.copyFileSync(stagedBinary, path.join(releaseDir, 'better_sqlite3.node'));
	fs.copyFileSync(stagedBinary, path.join(releaseDir, 'better_sqlite3.installed.node'));
	fs.rmSync(stagingRoot, { recursive: true, force: true });
	log('Installed better-sqlite3 native binary');
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
	await downloadNode();
	await installBetterSqlite3(path.join(RUNTIME_DIR, 'node.exe'));

	log('Resources ready in resources/');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
