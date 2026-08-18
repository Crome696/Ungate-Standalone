'use strict';

const { chmodSync, cpSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');

const ARCH_NAMES = {
	0: 'ia32',
	1: 'x64',
	2: 'armv7l',
	3: 'arm64',
	4: 'universal'
};

exports.default = async function beforePack(context) {
	const platform = context.electronPlatformName;
	const archName = typeof context.arch === 'string' ? context.arch : ARCH_NAMES[context.arch];

	if (!archName || archName === 'universal' || archName === 'ia32' || archName === 'armv7l') {
		throw new Error(`Unsupported packaging architecture: ${String(context.arch)}`);
	}

	const root = resolve(__dirname, '..');
	const sourceDir = join(root, 'resources', 'runtimes', `${platform}-${archName}`);
	const nodeName = platform === 'win32' ? 'node.exe' : 'node';
	const sourceBin = join(sourceDir, nodeName);

	if (!existsSync(sourceBin)) {
		throw new Error(
			`Bundled Node runtime not found for ${platform}-${archName} at ${sourceBin}. Run pnpm run prepare:resources first.`
		);
	}

	const runtimeDir = join(root, 'resources', 'runtime');
	rmSync(runtimeDir, { recursive: true, force: true });
	mkdirSync(runtimeDir, { recursive: true });
	cpSync(sourceDir, runtimeDir, { recursive: true });

	if (platform !== 'win32') {
		chmodSync(join(runtimeDir, nodeName), 0o755);
	}

	console.log(`[before-pack] staged Node runtime ${platform}-${archName}`);
};
