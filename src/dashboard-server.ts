import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { webDistDir } from './paths.js';

const MIME_TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

const SHIM_SCRIPT = `
<script>
(function () {
  let state = {};
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (message) { window.ungateHost.send(message); },
      getState: function () { return state; },
      setState: function (next) { state = next; }
    };
  };
  window.ungateHost.onEvent(function (message) {
    window.postMessage(message, '*');
  });
})();
</script>
`;

export class DashboardServer {
	private server: http.Server | null = null;
	private port: number | null = null;
	private apiPort: number | null = null;

	setApiPort(port: number | null): void {
		this.apiPort = port;
	}

	async start(): Promise<number> {
		if (this.server && this.port) {
			return this.port;
		}

		const distDir = webDistDir();

		this.server = http.createServer((request, response) => {
			this.handleRequest(distDir, request, response);
		});

		await new Promise<void>((resolve, reject) => {
			this.server?.once('error', reject);
			this.server?.listen(0, '127.0.0.1', () => resolve());
		});

		const address = this.server.address();

		if (!address || typeof address === 'string') {
			throw new Error('Dashboard server did not bind a TCP port');
		}

		this.port = address.port;

		return this.port;
	}

	url(): string {
		if (!this.port) {
			throw new Error('Dashboard server is not running');
		}

		return `http://127.0.0.1:${this.port}/`;
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve) => {
			if (!this.server) {
				resolve();

				return;
			}

			this.server.close(() => resolve());
		});

		this.server = null;
		this.port = null;
	}

	private handleRequest(distDir: string, request: http.IncomingMessage, response: http.ServerResponse): void {
		const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
		let relativePath = decodeURIComponent(requestUrl.pathname);

		if (relativePath === '/') {
			relativePath = '/index.html';
		}

		const filePath = path.normalize(path.join(distDir, relativePath));

		if (!filePath.startsWith(path.normalize(distDir))) {
			response.writeHead(403);
			response.end('Forbidden');

			return;
		}

		if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
			response.writeHead(404);
			response.end('Not found');

			return;
		}

		const extension = path.extname(filePath);
		const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';

		if (path.basename(filePath) === 'index.html') {
			let html = fs.readFileSync(filePath, 'utf8');
			html = html.replace(
				'</head>',
				`<script>window.__PORT__ = ${this.apiPort ?? 'null'}; window.__TS__ = ${Date.now()};</script>${SHIM_SCRIPT}</head>`
			);
			response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
			response.end(html);

			return;
		}

		response.writeHead(200, { 'Content-Type': contentType });
		fs.createReadStream(filePath).pipe(response);
	}
}

export function loadingPageUrl(message: string): string {
	const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Ungate</title>
    <style>
      body { margin: 0; font-family: Segoe UI, sans-serif; background: #101218; color: #ece8ff; display: grid; place-items: center; height: 100vh; }
      main { text-align: center; }
      p { opacity: 0.75; }
    </style>
  </head>
  <body>
    <main>
      <h1>Ungate</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
