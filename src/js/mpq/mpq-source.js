/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const listfile = require('../loader/listfile');
const constants = require('../constants');
const log = require('../log');
const core = require('../core');
const MPQReader = require('./mpq');

const compareMPQName = (...ab) => {
	ab = ab.map(t => {
		t = t.split('.')[0];
		if (t.indexOf('-') === -1) 
			t = t + '-0';
    
		return t;
	})

	return ab[0].localeCompare(ab[1]);
}

class MPQ {
	constructor(dir) {
		this.dir = dir;
		this.dataDir = path.join(dir, constants.BUILD.DATA_DIR);
	}

	async isValid() {
		try {
			await fsp.access(path.join(this.dataDir, 'common.MPQ'), fs.constants.F_OK);
			return true;
		} catch (e) {
			return false;
		}
	}

	async init() {
		log.write('Initializing MPQ installation: %s', this.dir);

		let locale;
		const config = await fsp.readFile(path.join(this.dir, 'wtf', 'config.wtf'), 'utf8');
		const configLines = config.split(/\r?\n/);
		for (const line of configLines) {
			const vals = line.split(' ');
			if (vals[1] === 'locale') {
				locale = vals[2].substring(1, vals[2].length - 1);
				break;
			}
		}

		if (locale == null) {
			log.write('Locale not found in config, defaulting to "enUS"');
			locale = 'enUS';
		}

		this.locale = locale;

		const mpqFiles = {'': [], [locale]: []};
		const patchFiles = {'': [], [locale]: []};

		for (const dirName of ['', locale]) {
			const dataDirName = path.join(this.dataDir, dirName);
			const dataDir = await fsp.opendir(dataDirName);
			for await (const dirent of dataDir) {
				const name = dirent.name.toLowerCase();
				if (!name.endsWith('.mpq')) 
					continue;
        

				const toPush = name.startsWith('patch') ? patchFiles : mpqFiles;
				toPush[dirName].push(path.join(dataDirName, dirent.name));
			}

			mpqFiles[dirName].sort(compareMPQName);
			patchFiles[dirName].sort(compareMPQName);
		}
		// TODO: This should work up to WotLK, but a real load order implementation is needed.

		this.mpqFilePaths = [].concat(mpqFiles[''], mpqFiles[locale], patchFiles[''], patchFiles[locale]);
	}

	async load() {
		log.write('Loading MPQ files: %s', this.mpqFilePaths);

		// const cacheKey = crypto.createHash('sha1').update(this.dir).digest('hex');
		// this.cache = new BuildCache(cacheKey);
		// await this.cache.init();

		this.progress = core.createProgress(this.mpqFilePaths.length + 1);

		this.mpqFiles = new Map();
		this.fileListMap = new Map();

		log.timeLog();
		for (const mpqFile of this.mpqFilePaths)
			await this._loadMPQ(mpqFile);
		log.timeEnd('Loaded %d entries from %d MPQ files', this.fileListMap.size, this.mpqFilePaths.length);

		core.view.casc = this;
		core.view.dataType = 'mpq';

		this.fileByID = new Map();
		const idMap = new Map();
		const nameMap = new Map();
		let id = 0;
		for (const [filePath, info] of this.fileListMap.entries()) {
			id += 1;
			idMap.set(id, filePath);
			nameMap.set(filePath, id);
			this.fileByID.set(id, info);
		}

		listfile.setTables(idMap, nameMap);
		await listfile.setupFilterListfile();

		await this.progress.step('Initializing components');
		await core.runLoadFuncs();
	}

	async _loadMPQ(mpqPath) {
		await this.progress.step(`Loading MPQ file: ${mpqPath}`);
		const mpq = new MPQReader(mpqPath);
		await mpq.load();
		this.mpqFiles.set(mpqPath, mpq);

		for (const filePath of (await mpq.getFileList())) {
			this.fileListMap.set(
				filePath.toLowerCase().replace(/\\/g, '/'),
				{ filePath, mpq }
			);
		}
	}

	/**
	 * Obtain a file by it's fileDataID.
	 * @param {number} fileDataID 
	 */
	async getFile(fileDataID) {
		const info = this.fileByID.get(fileDataID);
		return await info.mpq.readFile(info.filePath);
	}

	/**
	 * Obtain a file by a filename.
	 * fileName must exist in the loaded listfile.
	 * @param {string} fileName 
	 */
	async getFileByName(fileName) {
		const info = this.fileListMap.get(fileName);
		return await info.mpq.readFile(info.filePath);
	}
}

module.exports = MPQ;