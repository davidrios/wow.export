/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fsp = require('fs').promises;
const path = require('path');
const log = require('../log');
const generics = require('../generics');
const constants = require('../constants');
const core = require('../core');
const WDCReader = require('../db/WDCReader');
const BufferWrapper = require('../buffer');

const KEY_RING = {};
let isSaving = false;

/**
 * Retrieve a registered decryption key.
 * @param {string} keyName 
 */
const getKey = (keyName) => {
	return KEY_RING[keyName.toLowerCase()];
};

/**
 * Validate a keyName/key pair.
 * @param {string} keyName 
 * @param {string} key 
 */
const validateKeyPair = (keyName, key) => {
	if (keyName.length !== 16)
		return false;

	if (key.length !== 32)
		return false;

	return true;
};

/**
 * Add a decryption key. Subject to validation.
 * Decryption keys will be saved to disk on next tick.
 * Returns true if added, else false if the pair failed validation.
 * @param {string} keyName 
 * @param {string} key 
 */
const addKey = (keyName, key) => {
	if (!validateKeyPair(keyName, key))
		return false;

	keyName = keyName.toLowerCase();
	key = key.toLowerCase();

	if (KEY_RING[keyName] !== key) {
		KEY_RING[keyName] = key;
		log.write('Registered new decryption key %s -> %s', keyName, key);
		save();
	}

	return true;
};

/**
 * Load tact keys from disk cache and request updated
 * keys from remote server.
 */
const load = async () => {
	// Load from local cache.
	try {
		const tactKeys = JSON.parse(await fsp.readFile(constants.CACHE.TACT_KEYS, 'utf8'));

		// Validate/add our cached keys manually rather than passing to addKey()
		// to skip over redundant logging/saving calls.
		let added = 0;
		for (const [keyName, key] of Object.entries(tactKeys)) {
			if (validateKeyPair(keyName, key)) {
				KEY_RING[keyName.toLowerCase()] = key.toLowerCase();
				added++;
			} else {
				log.write('Skipping invalid tact key from cache: %s -> %s', keyName, key);
			}
		}

		log.write('Loaded %d tact keys from local cache.', added);
	} catch (e) {
		// No tactKeys cached locally, doesn't matter.
	}

	const tact_url = core.view.config.tactKeysURL;
	const tact_url_fallback = core.view.config.tactKeysFallbackURL;
	const res = await generics.get([tact_url, tact_url_fallback]);

	if (!res.ok)
		throw new Error(`Unable to update tactKeys, HTTP ${res.status}`);

	const data = await res.text();
	const lines = data.split(/\r\n|\n|\r/);
	let remoteAdded = 0;
	
	for (const line of lines) {
		const parts = line.split(' ');
		if (parts.length !== 2)
			continue;

		const keyName = parts[0].trim();
		const key = parts[1].trim();

		if (validateKeyPair(keyName, key)) {
			KEY_RING[keyName.toLowerCase()] = key.toLowerCase();
			remoteAdded++;
		} else {
			log.write('Skipping invalid remote tact key: %s -> %s', keyName, key);
		}
	}

	if (remoteAdded > 0)
		log.write('Added %d tact keys from %s', remoteAdded, tact_url);
};

/**
 * Request for tact keys to be saved on the next tick.
 * Multiple calls can be chained in the same tick.
 */
const save = async () => {
	if (!isSaving) {
		isSaving = true;
		setImmediate(doSave);
	}
};

/**
 * Saves the tact keys to disk.
 */
const doSave = async () => {
	await fsp.writeFile(constants.CACHE.TACT_KEYS, JSON.stringify(KEY_RING, null, '\t'), 'utf8');
	isSaving = false;
};

const formatToHex = (arr) => arr.map(i => i.toString(16).padStart(2, '0')).join('');

const printMissingFromDB = async () => {
	const keyDB = new WDCReader('DBFilesClient/TactKey.db2');
	await keyDB.parse();

	const lookup = new WDCReader('DBFilesClient/TactKeyLookup.db2');
	await lookup.parse();

	const newKeys = [];
	const unknownIds = new Set();

	for (const row of lookup.rows.values()) {
		const name = formatToHex(row.TACTID.reverse());
		if (KEY_RING[name] != null)
			continue;

		const keyRow = keyDB.getRow(row.ID);
		if (keyRow == null) {
			unknownIds.add(row.ID);
			continue;
		}

		const key = formatToHex(keyDB.getRow(row.ID).Key);
		newKeys.push(`${name.toUpperCase()} ${key.toUpperCase()}`);
	}

	const casc = core.view.casc
	if (unknownIds.size > 0 && casc.dataDir != null) {
		newKeys.push('');

		const versionDataDir = {
			wow: '_retail_',
			wow_classic: '_classic_',
			wow_classic_era: '_classic_era_',
		}[casc.build.Product];

		try {
			const dbCacheFile = path.join(path.dirname(casc.dataDir), versionDataDir, 'Cache', 'ADB', core.view.selectedLocaleKey, 'DBCache.bin');
			const data = await fsp.readFile(dbCacheFile);

			const buf = BufferWrapper.from(data);
			const magic = buf.readUInt32LE();
			if (magic !== 0x48544658)
				throw new Error('invalid magic');

			const version = buf.readUInt32LE();
			if (version !== 9)
				throw new Error('unsupported version');

			buf.move(4); // build id
			buf.move(32); // hash

			while (buf.remainingBytes > 0) {
				buf.move(4); // magic
				buf.move(4); // region_id
				buf.move(4); // index
				buf.move(4); // unique_id
				const tblHash = buf.readUInt32LE();
				const recId = buf.readUInt32LE();
				const size = buf.readUInt32LE();
				buf.move(1); // status
				buf.move(3); // pad

				if (tblHash === 0xdf2f53cf && unknownIds.has(recId) && size === 16) {
					const name = formatToHex(lookup.rows.get(recId).TACTID.reverse());
					const key = formatToHex(buf.readUInt8(size));
					newKeys.push(`${name.toUpperCase()} ${key.toUpperCase()}`);
				} else {
					buf.move(size);
				}
			}
		} catch (e) {
			console.warn('Could not read cache file', e);
		}
	}

	console.log(newKeys.join('\n'));
}

module.exports = { load, getKey, addKey, printMissingFromDB };