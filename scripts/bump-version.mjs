import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');

function parseSemver(version) {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
	if (!match) {
		throw new Error(`Unsupported version format in package.json: "${version}". Expected MAJOR.MINOR.PATCH.`);
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3])
	};
}

function computeNextMinorPatchZero(version) {
	const { major, minor } = parseSemver(version);
	return `${major}.${minor + 1}.0`;
}

const write = process.argv.includes('--write');
if (write && process.argv.includes('--dry-run')) {
	throw new Error('Use only one of --write or --dry-run');
}

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const currentVersion = String(pkg.version ?? '');
const nextVersion = computeNextMinorPatchZero(currentVersion);

if (write) {
	pkg.version = nextVersion;
	// Keep file stable for diffs and for electron-builder artifact naming.
	fs.writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log(nextVersion);

