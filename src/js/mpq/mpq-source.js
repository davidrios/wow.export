/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cp = require('child_process');
const listfile = require('../loader/listfile');
const constants = require('../constants');
const log = require('../log');
const core = require('../core');
const MPQReader = require('./mpq');
const BufferWrapper = require('../buffer');
const WDCReader = require('../db/WDCReader');
const BuildCache = require('../casc/build-cache');
const DBModelFileData = require('../db/caches/DBModelFileData');
const DBTextureFileData = require('../db/caches/DBTextureFileData');
const DBCreatures = require('../db/caches/DBCreatures');
const DBItemDisplays = require('../db/caches/DBItemDisplays');

const compareMPQName = (...ab) => {
	ab = ab.map(t => {
		t = t.split('.')[0];
		if (t.indexOf('-') === -1) 
			t = t + '-0';
    
		return t;
	})

	return ab[0].localeCompare(ab[1]);
}

const getDisplayItemBaseName = (fileName) => {
	fileName = fileName.toLowerCase();
	const dotIdx = fileName.lastIndexOf('.');
	let mode = 'm2';
	if (dotIdx !== -1) {
		if (fileName.substring(dotIdx) === '.mdx')
			mode = 'mdx';

		fileName = fileName.substring(0, dotIdx);
	}

	const firstPartIdx = fileName.indexOf('_');
	if (firstPartIdx === -1)
		return fileName;

	const firstPart = fileName.substring(0, firstPartIdx);
	switch (firstPart) {
		case 'lshoulder':
		case 'rshoulder':
			return fileName.substring(1);
		case 'helm':
			return mode === 'mdx' ? fileName : fileName.substring(0, fileName.lastIndexOf('_'));
		default:
			return fileName;
	}
}

class MPQ {
	constructor(dir) {
		this.dir = dir;
		this.dataDir = path.join(dir, constants.BUILD.DATA_DIR);
	}

	async isValid() {
		try {
			if (process.platform !== 'win32') {
				// Can't get the game version if not on Windows
				return false
			}

			await fsp.access(path.join(this.dataDir, 'common.mpq'), fs.constants.F_OK);
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

		const child = cp.spawn('powershell.exe', ['-Command', `(Get-Item "${path.join(this.dir, 'wow.exe')}").VersionInfo.FileVersion`]);
		const fileVersionPromise = new Promise((resolve) => {
			child.stdout.on('data', (data) => {
				const buf = new BufferWrapper(data);
				resolve(buf.readString());
			})
		});
		child.stdin.end();

		const fileVersion = await fileVersionPromise;
		this.buildVersion = fileVersion.split(', ').join('.').trim();
	}

	async load() {
		log.write('Loading MPQ files: %s', this.mpqFilePaths);

		this.cache = new BuildCache(this.buildVersion);
		await this.cache.init();

		this.progress = core.createProgress(this.mpqFilePaths.length + 3);

		this.mpqFiles = new Map();
		this.fileListMap = new Map();

		log.timeLog();
		for (let i = 0; i < this.mpqFilePaths.length; i++) {
			await this.progress.step(`Loading MPQ file: ${i+1}/${this.mpqFilePaths.length}`);
			await this._loadMPQ(this.mpqFilePaths[i]);
		}
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

		await this.loadTables();

		await this.progress.step('Initializing components');
		await core.runLoadFuncs();
	}

	async _loadMPQ(mpqPath) {
		const mpq = new MPQReader(mpqPath);
		await mpq.load();
		this.mpqFiles.set(mpqPath, mpq);

		for (const filePath of (await mpq.getFileList())) {
			this.fileListMap.set(
				listfile.normalizeFilename(filePath),
				{ filePath, mpq }
			);
		}
	}

	async loadTables() {
		const modelFileData = new Map();
		modelFileData.getAllRows = modelFileData.entries;

		const textureFileData = new Map();
		textureFileData.getAllRows = textureFileData.entries;

		let resourceID = 0;
		const m2Map = {};
		const blpMap = {};

		for (const filePath of this.fileListMap.keys()) {
			const match = filePath.match(/([^/]+?)(\.mdx|\.m2|\.blp)$/i);
			if (match == null)
				continue;

			let name = match[1];
			const ext = match[2];
			const map = ext === '.blp' ? blpMap : m2Map;

			if (ext === '.m2' && filePath.startsWith('item/'))
				name = getDisplayItemBaseName(name);

			if (map[name] == null)
				map[name] = ++resourceID;

			const FileDataID = listfile.getByFilename(filePath);

			if (ext === '.blp') {
				textureFileData.set(
					FileDataID,
					{ FileDataID, MaterialResourcesID: map[name], UsageType: 0 }
				);
			} else {
				modelFileData.set(
					FileDataID,
					{ FileDataID, ModelResourcesID: map[name] }
				);
			}
		}

		await DBModelFileData.initializeModelFileData(modelFileData);
		await DBTextureFileData.initializeTextureFileData(textureFileData);

		if (core.view.config.enableM2Skins) {
			await this.progress.step('Loading item displays');

			const itemDisplayInfo = new WDCReader('DBFilesClient/ItemDisplayInfo.dbc');
			await itemDisplayInfo.parse();

			for (const itemRow of itemDisplayInfo.getAllRows().values()) {
				itemRow.ModelResourcesID = itemRow.ModelName.map(
					modelName => m2Map[getDisplayItemBaseName(modelName)] || 0
				);

				itemRow.ModelMaterialResourcesID = itemRow.ModelTexture.map(
					textureName => blpMap[textureName.toLowerCase()] || 0
				);
			}

			await DBItemDisplays.initializeItemDisplays(itemDisplayInfo);

			await this.progress.step('Loading creature data');
			const creatureDisplayInfo = new WDCReader('DBFilesClient/CreatureDisplayInfo.dbc');
			await creatureDisplayInfo.parse();

			const creatureModelData = new WDCReader('DBFilesClient/CreatureModelData.dbc');
			await creatureModelData.parse();
			for (const modelRow of creatureModelData.getAllRows().values())
				modelRow.FileDataID = listfile.getByFilename(modelRow.ModelName);

			for (const displayRow of creatureDisplayInfo.getAllRows().values()) {
				const model = creatureModelData.getRow(displayRow.ModelID);
				displayRow.TextureVariationFileDataID =
					displayRow.TextureVariation
						.filter(t => t !== '')
						.map((t) => listfile.getByFilename(`${path.dirname(model.ModelName)}\\${t}.blp`));
			}

			await DBCreatures.initializeCreatureData(creatureDisplayInfo, creatureModelData, new Map());
		} else {
			await this.progress.step();
			await this.progress.step();
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
		const info = this.fileListMap.get(fileName.toLowerCase());
		return await info.mpq.readFile(info.filePath);
	}

	/**
		* Get the current build ID.
		* @returns {string}
		*/
	getBuildName() {
		return this.buildVersion;
	}
}

module.exports = MPQ;