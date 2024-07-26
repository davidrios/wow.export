BUILD_RELEASE = false;

const net = require('node:net');
const path = require('path');
const { Readable } = require('stream');
const msgpack = require('@msgpack/msgpack');
const BufferWrapper = require('./js/buffer');
const BuildCache = require('./js/casc/build-cache');

const win = nw.Window.get();
win.setProgressBar(-1); // Reset taskbar progress in-case it's stuck.
win.on('close', () => process.exit()); // Ensure we exit when window is closed.
win.showDevTools();

const fetches = {};
let cache = null;

async function processFetch(id, url, init) {
	try {
		const res = await fetch(url, init);
		fetches[id] = res;
		const resData = {
			bodyUsed: false,
			headers: Object.fromEntries(res.headers.entries()),
			ok: true,
			redirected: res.redirected,
			status: res.status,
			statusText: res.statusText,
			type: res.type,
			url: res.url,
		};
		return {response: resData};
	} catch (e) {
		console.error(e);
		return {error: e.toString()};
	}
}

async function processFetchText(id) {
	id = id.toString();
	try {
		if (cache == null) {
			cache = new BuildCache('FETCH');
			await cache.init();
		}

		const text = await fetches[id].text();
		cache.storeFile(id, BufferWrapper.from(text));
		delete fetches[id];
		return {path: cache.getFilePath(id)};
	} catch (e) {
		console.error(e);
		return {error: e.toString()};
	}
}

mainWindow = net.createServer().listen(path.join('\\\\?\\pipe', process.cwd(), 'main-window'));
mainWindow.on('connection', async (socket) => {
	socket.write(msgpack.encode({
		type: "nw.App",
		value: {
			dataPath: nw.App.dataPath,
			manifest: nw.App.manifest
		}
	}));

	const socketStream = Readable.from(socket, { objectMode: true });
	for await (const message of msgpack.decodeMultiStream(socketStream)) {
		console.log('main-window received:', message);

		switch (message.type) {
			case 'reload':
				chrome.runtime.reload();
				break;

			case 'setProgressBar':
				win.setProgressBar(message.value);
				break;

			case 'fetch':
				socket.write(msgpack.encode({
					type: 'fetchRes',
					id: message.id,
					result: await processFetch(message.id, message.url, message.init)
				}));
				break;

			case 'fetchText':
				socket.write(msgpack.encode({
					type: 'fetchTextRes',
					id: message.id,
					result: await processFetchText(message.id)
				}));
				break;
		}
	}
})

setTimeout(() => {
	document.querySelector('webview').showDevTools(true);
}, 100);
