import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README_PATH = path.join(ROOT, 'README.md');
const TAG_ARGUMENT_INDEX = process.argv.findIndex((argument) => argument === '--tag');
const TAG_ARGUMENT = process.argv.find((argument) => argument.startsWith('--tag='));
const tag = TAG_ARGUMENT?.slice('--tag='.length) ?? (TAG_ARGUMENT_INDEX >= 0 ? process.argv[TAG_ARGUMENT_INDEX + 1] : '') ?? '';

if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
	throw new Error(`Unsupported upstream tag: "${tag}". Expected vX.Y.Z.`);
}

const readme = fs.readFileSync(README_PATH, 'utf8');
const replacements = [
	{
		pattern: /(\| Upstream\s+\|\s+Ungate Git submodule `)(v\d+\.\d+\.\d+)(`\s+\|)/,
		replacement: `$1${tag}$3`
	},
	{
		pattern: /(vendor\/ungate\/.*pinned to `)(v\d+\.\d+\.\d+)(`\.)/,
		replacement: `$1${tag}$3`
	}
];

let updatedReadme = readme;

for (const { pattern, replacement } of replacements) {
	if (!pattern.test(updatedReadme)) {
		throw new Error(`README.md does not contain the expected upstream reference for ${pattern}.`);
	}

	updatedReadme = updatedReadme.replace(pattern, replacement);
}

if (updatedReadme !== readme) {
	fs.writeFileSync(README_PATH, updatedReadme);
}

console.log(`README.md upstream references set to ${tag}`);
