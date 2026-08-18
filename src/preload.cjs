const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ungateHost', {
	send(message) {
		ipcRenderer.send('dashboard:message', message);
	},
	onEvent(callback) {
		ipcRenderer.on('dashboard:event', (_event, message) => {
			callback(message);
		});
	}
});
