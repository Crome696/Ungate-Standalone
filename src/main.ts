import { app } from 'electron';

import { HostController } from './host-controller.js';

const host = new HostController();
let shuttingDown = false;

void app.whenReady().then(async () => {
	await host.start();
});

app.on('window-all-closed', () => {
	app.quit();
});

app.on('before-quit', (event) => {
	if (shuttingDown) {
		return;
	}

	event.preventDefault();
	shuttingDown = true;
	void host.stop().finally(() => {
		app.exit(0);
	});
});
