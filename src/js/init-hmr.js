/* eslint-disable no-global-assign */
const net = require('node:net');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Readable } = require('stream');
const msgpack = require('@msgpack/msgpack');

let fetchId = 0;
const fetchResolve = {};

let resolveMainWindow = null;

mainWindow = net.connect(
	path.join('\\\\?\\pipe', process.cwd(), 'main-window'),
	async function () {
		const clientStream = Readable.from(mainWindow, { objectMode: true });
		for await (const message of msgpack.decodeMultiStream(clientStream)) {
			// console.log('received from main-window:', message);

			switch (message.type) {
				case 'nw.App':
					nw.App = message.value;
					resolveMainWindow();
					break;

				case 'fetchRes':
				case 'fetchTextRes':
					fetchResolve[message.id](message.result);
					delete fetchResolve[message.id];
					break;
			}
		}
	}
);

mainWindow.isReady = new Promise((resolve) => resolveMainWindow = resolve);

mainWindow.setProgressBar = function (value) {
	mainWindow.write(msgpack.encode({ type: "setProgressBar", value }));
}

chrome.runtime = {
	reload() {
		mainWindow.write(msgpack.encode({ type: "reload" }));
	}
}

const origFetch = fetch;
fetch = async function (url, init) {
	if (!url.startsWith('http'))
		return await origFetch(url, init);

	// console.log('fetch', url, init);
	const id = ++fetchId;
	const promise = new Promise((resolve) => fetchResolve[id] = resolve);
	mainWindow.write(msgpack.encode({
		type: "fetch", url, init, id
	}));
	const result = await promise;
	if (result.error != null)
		throw new Error(result.error);

	// console.log('fetch res', result.response);
	async function text() {
		const promise = new Promise((resolve) => fetchResolve[id] = resolve);
		mainWindow.write(msgpack.encode({
			type: "fetchText", id
		}));
		const result = await promise;
		if (result.error != null)
			throw new Error(result.error);

		// console.log('got path', result.path);
		return await fsp.readFile(result.path, 'utf8');
	}
	return {
		...result.response,
		text,
		async json() {
			return await JSON.parse(await text());
		}
	};
}
