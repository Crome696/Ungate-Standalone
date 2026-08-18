function rejectAbort(reject: (reason?: unknown) => void): void {
	reject(new DOMException('Aborted', 'AbortError'));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			rejectAbort(reject);

			return;
		}

		const timer = setTimeout(() => {
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}

			resolve();
		}, ms);

		function onAbort(): void {
			clearTimeout(timer);

			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}

			rejectAbort(reject);
		}

		if (signal) {
			signal.addEventListener('abort', onAbort, { once: true });
		}
	});
}
