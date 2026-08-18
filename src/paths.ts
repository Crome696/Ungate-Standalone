import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function packagedResourcesRoot(): string {
	return process.resourcesPath;
}

function projectRoot(): string {
	return path.resolve(moduleDir, '..');
}

export function isPackaged(): boolean {
	return app.isPackaged;
}

export function runtimeDir(): string {
	if (isPackaged()) {
		return path.join(packagedResourcesRoot(), 'runtime');
	}

	return path.join(projectRoot(), 'resources', 'runtime');
}

export function apiDir(): string {
	if (isPackaged()) {
		return path.join(packagedResourcesRoot(), 'api');
	}

	return path.join(projectRoot(), 'resources', 'api');
}

export function webDistDir(): string {
	if (isPackaged()) {
		return path.join(packagedResourcesRoot(), 'web', 'dist');
	}

	return path.join(projectRoot(), 'resources', 'web', 'dist');
}

export function nodeBinaryPath(): string {
	const bundled = path.join(runtimeDir(), process.platform === 'win32' ? 'node.exe' : 'node');

	if (fs.existsSync(bundled)) {
		return bundled;
	}

	return process.platform === 'win32' ? 'node.exe' : 'node';
}

export function preloadPath(): string {
	return path.join(moduleDir, 'preload.cjs');
}

export function iconPath(): string {
	if (isPackaged()) {
		return path.join(packagedResourcesRoot(), 'icon.png');
	}

	return path.join(projectRoot(), 'resources', 'icon.png');
}
