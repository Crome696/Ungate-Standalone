import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { createGunzip } from 'node:zlib';

import * as tar from 'tar';

async function fixture(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ungate-tar-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));

	return root;
}

// Match the streaming tar API used by prepare-resources.mjs, without downloads.
async function extract(body, destination) {
	await pipeline(Readable.fromWeb(body), createGunzip(), tar.extract({ cwd: destination }));
}

test('extracts a gzipped runtime archive with nested paths and binary bytes', async (t) => {
	const root = await fixture(t);
	const source = path.join(root, 'source');
	const destination = path.join(root, 'destination');
	const payload = Buffer.from([0, 1, 127, 128, 255]);
	await fs.mkdir(path.join(source, 'node-runtime', 'bin'), { recursive: true });
	await fs.mkdir(destination);
	await fs.writeFile(path.join(source, 'node-runtime', 'bin', 'node'), payload);
	const archive = path.join(root, 'node.tar.gz');
	await tar.create({ cwd: source, file: archive, gzip: true }, ['node-runtime']);
	const body = Readable.toWeb(Readable.from(await fs.readFile(archive)));
	await extract(body, destination);
	assert.deepEqual(await fs.readFile(path.join(destination, 'node-runtime', 'bin', 'node')), payload);
});

test('rejects corrupt gzip input', async (t) => {
	const destination = await fixture(t);
	const body = Readable.toWeb(Readable.from(Buffer.from('not a gzip archive')));
	await assert.rejects(extract(body, destination), { code: 'Z_DATA_ERROR' });
	assert.deepEqual(await fs.readdir(destination), []);
});

test('does not extract parent-traversal entries outside the destination', async (t) => {
	const root = await fixture(t);
	const destination = path.join(root, 'destination');
	await fs.mkdir(destination);
	const header = new tar.Header({ path: '../escaped', size: 1, mode: 0o644, type: 'File' });
	header.encode();
	const archive = Buffer.concat([header.block, Buffer.from('x'), Buffer.alloc(511 + 1024)]);
	await pipeline(Readable.from(archive), tar.extract({ cwd: destination }));
	await assert.rejects(fs.stat(path.join(root, 'escaped')), { code: 'ENOENT' });
	assert.deepEqual(await fs.readdir(destination), []);
});
