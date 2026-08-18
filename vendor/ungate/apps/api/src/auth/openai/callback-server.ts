import { createServer, type Server, type ServerResponse } from 'node:http';

import { sleep } from '@ungate/shared';
import { config } from 'src/config';

export class OpenAICallbackServer {
	private static callbackServer: Server | null = null;
	private static callbackShutdownAbort: AbortController | null = null;

	public static async start(
		onCallback: (requestUrl: string | undefined, path: string, response: ServerResponse) => Promise<void>
	): Promise<void> {
		await this.stop();

		const callbackUrl = new URL(config.openai.oauth.redirectUri);
		const port = parseInt(callbackUrl.port, 10);
		const path = callbackUrl.pathname;
		const server = createServer((request, response) => {
			void onCallback(request.url, path, response);
		});

		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => {
				server.off('error', reject);
				resolve();
			});
		});

		this.callbackServer = server;
		if (this.callbackShutdownAbort) {
			this.callbackShutdownAbort.abort();
		}

		this.callbackShutdownAbort = new AbortController();
		const shutdownSignal = this.callbackShutdownAbort.signal;
		void sleep(10 * 60 * 1000, shutdownSignal)
			.then(() => this.stop())
			.catch(() => {});
	}

	public static async stop(): Promise<void> {
		if (this.callbackShutdownAbort) {
			this.callbackShutdownAbort.abort();
			this.callbackShutdownAbort = null;
		}

		if (!this.callbackServer) {
			return;
		}

		const server = this.callbackServer;
		this.callbackServer = null;
		await new Promise<void>((resolve) => {
			server.close(() => {
				resolve();
			});
		});
	}
}
