const path = require('path');
const core = require('/js/core');
const log = require('/js/log');
const listfile = require('/js/casc/listfile');
const generics = require('/js/generics');
const WDCReader = require('/js/db/WDCReader');

let shared;

export default async function (view) {
	if (shared !== undefined)
		return shared;

	const creatureDbs = listfile.getFilteredEntries(/\/creature(displayinfo|modeldata|sounddata)\.db2/);

	// Initialize a loading screen.
	const progress = core.createProgress(creatureDbs.length + 4);
	view.setScreen('loading');
	view.isBusy++;

	try {
		await progress.step('Loading databases mapping...');
		const db2NameMap = Object.fromEntries(
			(await generics.getJSON("https://api.wow.tools/databases/"))
				.map(({name, displayName}) => [name, displayName])
		);

		const allTables = {};
		for (const file of creatureDbs) {
			try {
				const name = path.basename(file.fileName, '.db2');

				await progress.step(`Loading ${name}...`);

				const fdata = await view.casc.getFile(file.fileDataID);
				const db = new WDCReader(db2NameMap[name]);
				await db.parse(fdata);

				allTables[name] = db;
			} catch (e) {
				console.error('Couldnt load table', file.fileName, e);
			}
		}

		await progress.step('Loading ModelFileData.db2...');
		const modelFileData = new WDCReader('DBFilesClient/ModelFileData.db2');
		await modelFileData.parse();
		allTables.modelfiledata = modelFileData;

		await progress.step('Loading SoundKit.db2...');
		const soundKit = new WDCReader('DBFilesClient/SoundKit.db2');
		await soundKit.parse();
		allTables.soundkit = soundKit;

		await progress.step('Loading SoundKitEntry.db2...');
		const soundKitEntry = new WDCReader('DBFilesClient/SoundKitEntry.db2');
		await soundKitEntry.parse();
		const soundkitentrymap = new Map();
		for (const entry of soundKitEntry.rows.values()) {
			if (!soundkitentrymap.has(entry.SoundKitID))
				soundkitentrymap.set(entry.SoundKitID, []);
			soundkitentrymap.get(entry.SoundKitID).push(entry);
		}
		allTables.soundkitentrymap = soundkitentrymap;

		shared = allTables;
	} catch (e) {
		shared = null;
		console.error('Error loading data', e);
		view.setToast('error', 'Error loading data', { 'View log': () => log.openRuntimeLog() }, -1);
	} finally {
		// Show the characters screen.
		view.loadPct = -1;
		view.isBusy--;
		view.setScreen('tab-creatures');
	}

	return shared;
}