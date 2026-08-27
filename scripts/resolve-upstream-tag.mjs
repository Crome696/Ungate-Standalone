import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativeSubmodulePath = process.argv[2] ?? 'vendor/ungate';
const submodulePath = path.resolve(ROOT, relativeSubmodulePath);
const relativeResolvedPath = path.relative(ROOT, submodulePath);

if (
	!relativeResolvedPath ||
	relativeResolvedPath === '..' ||
	relativeResolvedPath.startsWith(`..${path.sep}`) ||
	path.isAbsolute(relativeResolvedPath)
) {
	throw new Error(`Submodule path must be inside the repository: ${relativeSubmodulePath}`);
}

const strictSemverTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
let output;

try {
	output = execFileSync('git', ['-C', submodulePath, 'tag', '--points-at', 'HEAD'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
} catch (error) {
	const details = error.stderr?.toString().trim();
	throw new Error(`Could not enumerate tags for ${relativeSubmodulePath}.${details ? ` ${details}` : ''}`);
}

const validTags = output
	.split(/\r?\n/)
	.map((tag) => tag.trim())
	.filter((tag) => strictSemverTag.test(tag));

if (validTags.length !== 1) {
	throw new Error(
		`Expected exactly one strict upstream SemVer tag at HEAD; found ${validTags.length}: ${validTags.join(', ') || '(none)'}`
	);
}

console.log(validTags[0]);
