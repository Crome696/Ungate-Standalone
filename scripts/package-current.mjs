import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBuilderCli = require.resolve('electron-builder/cli.js');

const TARGETS = {
	win32: ['--win', 'portable', 'nsis', '--x64'],
	darwin: ['--mac', 'dmg', 'zip', '--x64', '--arm64'],
	linux: ['--linux', 'AppImage', 'deb', '--x64', '--arm64']
};

const flags = TARGETS[process.platform];

if (!flags) {
	throw new Error(`Packaging is not supported on ${process.platform}. Use Windows, macOS, or Linux.`);
}

const result = spawnSync(process.execPath, [electronBuilderCli, ...flags, '--publish', 'never'], {
	stdio: 'inherit'
});

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
