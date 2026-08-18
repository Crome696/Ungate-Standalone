declare module 'cloudflared' {
	export const bin: string;
	export function install(to?: string): Promise<string>;
	export function use(binary: string): void;
	export class Tunnel {
		static quick(url: string, options?: Record<string, string>): Tunnel;
		stop(): void;
		on(event: 'url', listener: (url: string) => void): this;
		on(event: 'stderr', listener: (data: string) => void): this;
		on(event: 'error', listener: (error: Error) => void): this;
		on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
	}
}

declare module 'tar' {
	import type { Writable } from 'node:stream';
	export function extract(options: { cwd: string }): Writable;
}
