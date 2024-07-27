/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// BUILD_RELEASE will be set globally by Terser during bundling allowing us
// to discern a production build. However, for debugging builds it will throw
// a ReferenceError without the following check. Any code that only runs when
// BUILD_RELEASE is set to false will be removed as dead-code during compile.
BUILD_RELEASE = typeof BUILD_RELEASE !== 'undefined';

const path = require('path');

if (typeof chrome.runtime === 'undefined') {
	const origRequire = require;
	// eslint-disable-next-line no-global-assign
	require = (id) => {
		if (id.startsWith('.'))
			id = path.join('src', id);
		return origRequire(id);
	}
	require('./js/init-hmr');
} else {
	const win = nw.Window.get();
	win.on('close', () => process.exit()); // Ensure we exit when window is closed.

	if (!BUILD_RELEASE)
		win.showDevTools();

	mainWindow = {
		setProgressBar(value) {
			nw.Window.get().setProgressBar(value);
		},
		isReady: new Promise((resolve) => resolve())
	}
}
