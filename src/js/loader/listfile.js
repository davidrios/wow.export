/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const constants = require('../constants');
const core = require('../core');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');

const WDCReader = require('../db/WDCReader');
const DBTextureFileData = require('../db/caches/DBTextureFileData');
const DBModelFileData = require('../db/caches/DBModelFileData');

class Listfile {
	constructor(nameLookup, idLookup, loaded) {
		this.replace(nameLookup, idLookup, loaded);
	}

	replace(nameLookup, idLookup, loaded) {
		this.nameLookup = nameLookup ?? new Map();
		this.idLookup = idLookup ?? new Map();
		this.loaded = !!loaded;
	}

	/**
		* Load unknown files from TextureFileData/ModelFileData.
		* Must be called after DBTextureFileData/DBModelFileData have loaded.
		*/
	async loadUnknowns () {
		const unkBlp = await this.loadIDTable(DBTextureFileData.getFileDataIDs(), '.blp');
		const unkM2 = await this.loadIDTable(DBModelFileData.getFileDataIDs(), '.m2');

		log.write('Added %d unknown BLP textures from TextureFileData to listfile', unkBlp);
		log.write('Added %d unknown M2 models from ModelFileData to listfile', unkM2);

		// Load unknown sounds from SoundKitEntry table.
		const soundKitEntries = new WDCReader('DBFilesClient/SoundKitEntry.db2');
		await soundKitEntries.parse();

		let unknownCount = 0;
		for (const entry of soundKitEntries.getAllRows().values()) {
			if (!this.idLookup.has(entry.FileDataID)) {
				// List unknown sound files using the .unk_sound extension. Files will be
				// dynamically checked upon export and given the correct extension.
				const fileName = 'unknown/' + entry.FileDataID + '.unk_sound';
				this.idLookup.set(entry.FileDataID, fileName);
				this.nameLookup.set(fileName, entry.FileDataID);
				unknownCount++;
			}
		}

		log.write('Added %d unknown sound files from SoundKitEntry to listfile', unknownCount);
	}

	/**
		* Load file IDs from a data table.
		* @param {Set} ids
		* @param {string} ext 
		*/
	async loadIDTable(ids, ext) {
		let loadCount = 0;

		for (const fileDataID of ids) {
			if (!this.idLookup.has(fileDataID)) {
				const fileName = 'unknown/' + fileDataID + ext;
				this.idLookup.set(fileDataID, fileName);
				this.nameLookup.set(fileName, fileDataID);
				loadCount++;
			}
		}

		return loadCount;
	}

	/**
		* Return an array of filenames ending with the given extension(s).
		* @param {string|Array} exts 
		* @returns {Array}
		*/
	getFilenamesByExtension(exts) {
		// Box into an array for reduced code.
		if (!Array.isArray(exts))
			exts = [exts];

		let entries = [];

		for (const [fileDataID, filename] of this.idLookup.entries()) {
			for (const ext of exts) {
				if (Array.isArray(ext)) {
					if (filename.endsWith(ext[0]) && !filename.match(ext[1])) {
						entries.push(fileDataID);
						continue;
					}
				} else {
					if (filename.endsWith(ext)) {
						entries.push(fileDataID);
						continue;
					}
				}
			}
		}

		return this.formatEntries(entries);
	}

	/**
		* Sort and format listfile entries for file list display.
		* @param {Array} entries 
		* @returns {Array}
		*/
	formatEntries(entries) {
		// If sorting by ID, perform the sort while the array is only IDs.
		if (core.view.config.listfileSortByID)
			entries.sort((a, b) => a - b);

		if (core.view.config.listfileShowFileDataIDs)
			entries = entries.map(e => this.getByIDOrUnknown(e) + ' [' + e + ']');
		else
			entries = entries.map(e => this.getByIDOrUnknown(e));

		// If sorting by name, sort now that the filenames have been added.
		if (!core.view.config.listfileSortByID)
			entries.sort();

		return entries;
	}

	ingestIdentifiedFiles(entries) {
		for (const [fileDataID, ext] of entries) {
			const fileName = 'unknown/' + fileDataID + ext;
			this.idLookup.set(fileDataID, fileName);
			this.nameLookup.set(fileName, fileDataID);
		}

		core.events.emit('listfile-needs-updating');
	}

	/**
		* Returns a full listfile, sorted and formatted.
		* @returns {Array}
		*/
	getFullListfile() {
		return this.formatEntries([...this.idLookup.keys()]);
	}

	/**
		* Get a filename from a given file data ID.
		* @param {number} id 
		* @returns {string|undefined}
		*/
	getByID(id) {
		return this.idLookup.get(id);
	}

	/**
		* Get a filename from a given file data ID or format it as an unknown file.
		* @param {number} id 
		* @param {string} [ext]
		* @returns {string}
		*/
	getByIDOrUnknown(id, ext = '') {
		return this.idLookup.get(id) ?? formatUnknownFile(id, ext);
	}

	/**
		* Get a file data ID by a given file name.
		* @param {string} filename
		* @returns {number|undefined} 
		*/
	getByFilename(filename) {
		filename = normalizeFilename(filename);
		let lookup = this.nameLookup.get(filename);

		// In the rare occasion we have a reference to an MDL/MDX file and it fails
		// to resolve (as expected), attempt to resolve the M2 of the same name.
		if (!lookup && (filename.endsWith('.mdl') || filename.endsWith('mdx')))
			lookup = this.nameLookup.get(ExportHelper.replaceExtension(filename, '.m2').replace(/\\/g, '/'));

		return lookup;
	}

	/**
		* Returns an array of listfile entries filtered by the given search term.
		* @param {string|RegExp} search 
		* @returns {Array.<object>}
		*/
	getFilteredEntries(search) {
		const results = [];
		const isRegExp = search instanceof RegExp;

		for (const [fileDataID, fileName] of this.idLookup.entries()) {
			if (isRegExp ? fileName.match(search) : fileName.includes(search))
				results.push({ fileDataID, fileName });
		}

		return results;
	}

	/**
		* Strips a prefixed file ID from a listfile entry.
		* @param {string} entry 
		* @returns {string}
		*/
	stripFileEntry(entry) {
		if (typeof entry === 'string' && entry.includes(' ['))
			return entry.substring(0, entry.lastIndexOf(' ['));

		return entry;
	}

	/**
		* Returns true if a listfile has been loaded.
		* @returns {boolean}
		*/
	get isLoaded () {
		return this.loaded;
	}

	updateListfileFilters() {
		core.view.listfileTextures = this.getFilenamesByExtension('.blp');
		core.view.listfileSounds = this.getFilenamesByExtension(['.ogg', '.mp3', '.unk_sound']);
		core.view.listfileVideos = this.getFilenamesByExtension('.avi');
		core.view.listfileText = this.getFilenamesByExtension(['.txt', '.lua', '.xml', '.sbt', '.wtf', '.htm', '.toc', '.xsd']);
		core.view.listfileModels = this.getFilenamesByExtension(getModelFormats());
		core.view.listfileDB2s = this.getFilenamesByExtension('.db2');
	}

	/**
		* Creates filtered versions of the master listfile.
		*/
	async setupFilterListfile() {
		core.events.on('listfile-needs-updating', () => this.updateListfileFilters());

		core.view.$watch('config.listfileSortByID', () => core.events.emit('listfile-needs-updating'));
		core.view.$watch('config.listfileShowFileDataIDs', () => core.events.emit('listfile-needs-updating'), { immediate: true });
	}
}

/**
	* Strips a prefixed file ID from a listfile entry.
	* @param {string} entry 
	* @returns {string}
	*/
const stripFileEntry = (entry) => {
	if (typeof entry === 'string' && entry.includes(' ['))
		return entry.substring(0, entry.lastIndexOf(' ['));

	return entry;
};

/**
	* Returns a file path for an unknown fileDataID.
	* @param {number} fileDataID 
	* @param {string} [ext]
	*/
const formatUnknownFile = (fileDataID, ext = '') => {
	return 'unknown/' + fileDataID + ext;
};

/**
	* Returns an array of model formats to display.
	* @returns {Array}
	*/
const getModelFormats = () => {
	// Filters for the model viewer depending on user settings.
	const modelExt = [];
	if (core.view.config.modelsShowM2)
		modelExt.push('.m2');
	
	if (core.view.config.modelsShowWMO)
		modelExt.push(['.wmo', constants.LISTFILE_MODEL_FILTER]);

	return modelExt;
}

const normalizeFilename = (filename) => filename.toLowerCase().replace(/\\/g, '/');

module.exports = {
	Listfile,
	stripFileEntry,
	formatUnknownFile,
	normalizeFilename
};