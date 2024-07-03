/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const util = require('util');
const BLTEReader = require('./blte-reader').BLTEReader;
const { Listfile } = require('../loader/listfile');
const log = require('../log');
const core = require('../core');
const LocaleFlag = require('./locale-flags').flags;
const ContentFlag = require('./content-flags');
const InstallManifest = require('./install-manifest');
const constants = require('../constants');
const generics = require('../generics');
const BufferWrapper = require('../buffer');

const WDCReader = require('../db/WDCReader');
const DBModelFileData = require('../db/caches/DBModelFileData');
const DBTextureFileData = require('../db/caches/DBTextureFileData');
const DBItemDisplays = require('../db/caches/DBItemDisplays');
const DBCreatures = require('../db/caches/DBCreatures');
const MultiMap = require('../MultiMap');

const ENC_MAGIC = 0x4E45;
const ROOT_MAGIC = 0x4D465354;

class CASC {
	constructor(isRemote = false) {
		this.encodingSizes = new Map();
		this.encodingKeys = new Map();
		this.rootTypes = [];
		this.rootEntries = new Map();
		this.isRemote = isRemote;
		this.listfile = new Listfile();

		// Listen for configuration changes to cascLocale.
		this.unhookConfig = core.view.$watch('config.cascLocale', (locale) => {
			if (!isNaN(locale)) {
				this.locale = locale;
			} else {
				log.write('Invalid locale set in configuration, defaulting to enUS');
				this.locale = LocaleFlag.enUS;
			}
		}, { immediate: true });
	}

	/**
	 * Provides an array of fileDataIDs that match the current locale.
	 * @returns {Array.<number>}
	 */
	getValidRootEntries() {
		const entries = [];

		for (const [fileDataID, entry] of this.rootEntries.entries()) {
			let include = false;

			for (const rootTypeIdx of entry.keys()) {
				const rootType = this.rootTypes[rootTypeIdx];
				if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlag.LowViolence) === 0)) {
					include = true;
					break;
				}
			}

			if (include)
				entries.push(fileDataID);
		}

		return entries;
	}

	/**
	 * Retrieves the install manifest for this CASC instance.
	 * @returns {InstallManifest}
	 */
	async getInstallManifest() {
		const installKeys = this.buildConfig.install.split(' ');
		const installKey = installKeys.length === 1 ? this.encodingKeys.get(installKeys[0]) : installKeys[1];

		const raw = this.isRemote ? await this.getDataFile(this.formatCDNKey(installKey)) : await this.getDataFileWithRemoteFallback(installKey);
		const manifest = new BLTEReader(raw, installKey);
		
		return new InstallManifest(manifest);
	}

	/**
	 * Obtain a file by it's fileDataID.
	 * @param {number} fileDataID 
	 */
	async getFile(fileDataID) {
		const root = this.rootEntries.get(fileDataID);
		if (root === undefined)
			throw new Error('fileDataID does not exist in root: ' + fileDataID);

		let contentKey = null;
		for (const [rootTypeIdx, key] of root.entries()) {
			const rootType = this.rootTypes[rootTypeIdx];

			// Select the first root entry that has a matching locale and no LowViolence flag set.
			if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlag.LowViolence) === 0)) {
				contentKey = key;
				break;
			}
		}

		if (contentKey === null)
			throw new Error('No root entry found for locale: ' + this.locale);

		const encodingKey = this.encodingKeys.get(contentKey);
		if (encodingKey === undefined)
			throw new Error('No encoding entry found: ' + contentKey);

		// This underlying implementation returns the encoding key rather than a
		// data file, allowing CASCLocal and CASCRemote to implement readers.
		return encodingKey;
	}

	/**
	 * @param {string} contentKey 
	 * @returns {string}
	 */
	getEncodingKeyForContentKey(contentKey) {
		const encodingKey = this.encodingKeys.get(contentKey);
		if (encodingKey === undefined)
			throw new Error('No encoding entry found: ' + contentKey);

		// This underlying implementation returns the encoding key rather than a
		// data file, allowing CASCLocal and CASCRemote to implement readers.
		return encodingKey;
	}

	/**
	 * Obtain a file by a filename.
	 * fileName must exist in the loaded listfile.
	 * @param {string} fileName 
	 * @param {boolean} [partialDecrypt=false]
	 * @param {boolean} [suppressLog=false]
	 * @param {boolean} [supportFallback=true]
	 * @param {boolean} [forceFallback=false]
	 */
	async getFileByName(fileName, partialDecrypt = false, suppressLog = false, supportFallback = true, forceFallback = false) {
		let fileDataID;

		// If filename is "unknown/<fdid>", skip listfile lookup
		if (fileName.startsWith("unknown/") && !fileName.includes('.'))
			fileDataID = parseInt(fileName.split('/')[1]);
		else 
			fileDataID = this.listfile.getByFilename(fileName);

		if (fileDataID === undefined)
			throw new Error('File not mapping in listfile: ' + fileName);

		return await this.getFile(fileDataID, partialDecrypt, suppressLog, supportFallback, forceFallback);
	}

	/**
	 * Load the listfile for selected build.
	 * @param {string} buildKey 
	 */
	async loadListfile(buildKey) {
		await this.progress.step('Loading listfile');

		log.write('Loading listfile for build %s', buildKey);

		let url = String(core.view.config.listfileURL);
		if (typeof url !== 'string')
			throw new Error('Missing/malformed listfileURL in configuration!');

		// Replace optional buildID wildcard.
		if (url.includes('%s'))
			url = util.format(url, buildKey);

		const idLookup = new Map();
		const nameLookup = new Map();

		let data;
		if (url.startsWith('http')) {
			// Listfile URL is http, check for cache/updates.
			let requireDownload = false;
			const cached = await this.cache.getFile(constants.CACHE.BUILD_LISTFILE);

			if (this.cache.meta.lastListfileUpdate) {
				let ttl = Number(core.view.config.listfileCacheRefresh) || 0;
				ttl *= 24 * 60 * 60 * 1000; // Reduce from days to milliseconds.

				if (ttl === 0 || (Date.now() - this.cache.meta.lastListfileUpdate) > ttl) {
					// Local cache file needs updating (or has invalid manifest entry).
					log.write('Cached listfile for %s is out-of-date (> %d).', buildKey, ttl);
					requireDownload = true;
				} else {
					// Ensure that the local cache file *actually* exists before relying on it.
					if (cached === null) {
						log.write('Listfile for %s is missing despite meta entry. User tamper?', buildKey);
						requireDownload = true;
					} else {
						log.write('Listfile for %s is cached locally.', buildKey);
					}
				}
			} else {
				// This listfile has never been updated.
				requireDownload = true;
				log.write('Listfile for %s is not cached, downloading fresh.', buildKey);
			}

			if (requireDownload) {
				try {
					const fallback_url = String(core.view.config.listfileFallbackURL);
					data = await generics.downloadFile([url, fallback_url]);

					this.cache.storeFile(constants.CACHE.BUILD_LISTFILE, data);

					this.cache.meta.lastListfileUpdate = Date.now();
					this.cache.saveManifest();
				} catch (e) {
					if (cached === null)
						throw new Error('Failed to download listfile, no cached version for fallback');

					data = cached;
				}
			} else {
				data = cached;
			}
		} else {
			// User has configured a local listfile location.
			log.write('Loading user-defined local listfile: %s', url);
			data = await BufferWrapper.readFile(url);
		}

		// Parse all lines in the listfile.
		// Example: 53187;sound/music/citymusic/darnassus/druid grove.mp3
		const lines = data.readLines();
		for (const line of lines) {
			if (line.length === 0)
				continue;

			const tokens = line.split(';');

			if (tokens.length !== 2) {
				log.write('Invalid listfile line (token count): %s', line);
				return;
			}

			const fileDataID = Number(tokens[0]);
			if (isNaN(fileDataID)) {
				log.write('Invalid listfile line (non-numerical ID): %s', line);
				return;
			}

			if (this.rootEntries.has(fileDataID))
			{
				const fileName = tokens[1].toLowerCase();
				idLookup.set(fileDataID, fileName);
				nameLookup.set(fileName, fileDataID);
			}
		}

		if (idLookup.size === 0) {
			log.write('Invalid listfile count (no entries)');
			return;
		}

		log.write('%d listfile entries loaded', idLookup.size);

		if (idLookup.size === 0)
			throw new Error('No listfile entries found');

		this.listfile.replace(nameLookup, idLookup, true);
	}

	/**
	 * Load tables that are required globally.
	 */
	async loadTables() {
		await this.progress.step('Loading model file data');
		const modelFileData = new WDCReader('DBFilesClient/ModelFileData.db2');
		await modelFileData.parse();
		await DBModelFileData.initializeModelFileData(modelFileData);

		await this.progress.step('Loading texture file data');
		const textureFileData = new WDCReader('DBFilesClient/TextureFileData.db2');
		await textureFileData.parse();
		await DBTextureFileData.initializeTextureFileData(textureFileData);

		// Once the above two tables have loaded, ingest fileDataIDs as
		// unknown entries to the listfile.
		if (core.view.config.enableUnknownFiles) {
			this.progress.step('Checking data tables for unknown files');
			await this.listfile.loadUnknowns();
		} else {
			await this.progress.step();
		}

		if (core.view.config.enableM2Skins) {
			await this.progress.step('Loading item displays');
			const itemDisplayInfo = new WDCReader('DBFilesClient/ItemDisplayInfo.db2');
			await itemDisplayInfo.parse();
			await DBItemDisplays.initializeItemDisplays(itemDisplayInfo);

			await this.progress.step('Loading creature data');
			const creatureDisplayInfo = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2');
			await creatureDisplayInfo.parse();

			const creatureModelData = new WDCReader('DBFilesClient/CreatureModelData.db2');
			await creatureModelData.parse();

			const creatureGeosetMap = await DBCreatures.initializeCreatureGeosetData();
			await DBCreatures.initializeCreatureData(creatureDisplayInfo, creatureModelData, creatureGeosetMap);
		} else {
			await this.progress.step();
		}
	}

	/**
	 * Initialize external components as part of the CASC load process.
	 * This allows us to do it seamlessly under the cover of the same loading screen.
	 */
	async initializeComponents() {
		await this.progress.step('Initializing components');
		await core.runLoadFuncs();

		// Dispatch RCP hook.
		core.rcp.dispatchHook('HOOK_INSTALL_READY', {
			type: this.constructor.name,
			build: this.build,
			buildConfig: this.buildConfig,
			buildName: this.getBuildName(),
			buildKey: this.getBuildKey()
		});
	}

	/**
	 * Parse entries from a root file.
	 * @param {BufferWrapper} data 
	 * @param {string} hash 
	 * @returns {number}
	 */
	async parseRootFile(data, hash) {
		const root = new BLTEReader(data, hash);

		const magic = root.readUInt32LE();
		const rootTypes = this.rootTypes;
		const rootEntries = this.rootEntries;

		if (magic == ROOT_MAGIC) { // 8.2
			let totalFileCount = root.readUInt32LE();
			let namedFileCount = root.readUInt32LE();

			// TEMP FIX: If total file count is very low, we're dealing with a post-10.1.7 root format.
			if (totalFileCount < 100) {
				// The already read values totalFileCount and namedFileCount are now headerSize and version respectively.
				// However, since we already read those we just reread the proper file counts for now.
				totalFileCount = root.readUInt32LE();
				namedFileCount = root.readUInt32LE();
				root.readUInt32LE(); // Padding?
			}

			const allowNamelessFiles = totalFileCount !== namedFileCount;
		
			while (root.remainingBytes > 0) {
				const numRecords = root.readUInt32LE();
				
				const contentFlags = root.readUInt32LE();
				const localeFlags = root.readUInt32LE();

				const fileDataIDs = new Array(numRecords);

				let fileDataID = 0;
				for (let i = 0; i < numRecords; i++)  {
					const nextID = fileDataID + root.readInt32LE();
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				// Parse MD5 content keys for entries.
				for (let i = 0; i < numRecords; i++) {
					const fileDataID = fileDataIDs[i];
					let entry = rootEntries.get(fileDataID);

					if (!entry) {
						entry = new Map();
						rootEntries.set(fileDataID, entry);
					}

					entry.set(rootTypes.length, root.readHexString(16));
				}

				// Skip lookup hashes for entries.
				if (!(allowNamelessFiles && contentFlags & ContentFlag.NoNameHash))
					root.move(8 * numRecords);

				// Push the rootType after parsing the block so that
				// rootTypes.length can be used for the type index above.
				rootTypes.push({ contentFlags, localeFlags });
			}
		} else { // Classic
			root.seek(0);
			while (root.remainingBytes > 0) {
				const numRecords = root.readUInt32LE();

				const contentFlags = root.readUInt32LE();
				const localeFlags = root.readUInt32LE();

				const fileDataIDs = new Array(numRecords);

				let fileDataID = 0;
				for (let i = 0; i < numRecords; i++)  {
					const nextID = fileDataID + root.readInt32LE();
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				// Parse MD5 content keys for entries.
				for (let i = 0; i < numRecords; i++) {
					const key = root.readHexString(16);
					root.move(8); // hash

					const fileDataID = fileDataIDs[i];
					let entry = rootEntries.get(fileDataID);

					if (!entry) {
						entry = new Map();
						rootEntries.set(fileDataID, entry);
					}

					entry.set(rootTypes.length, key);
				}

				// Push the rootType after parsing the block so that
				// rootTypes.length can be used for the type index above.
				rootTypes.push({ contentFlags, localeFlags });
			}
		}

		return rootEntries.size;
	}
	
	/**
	 * Parse entries from an encoding file.
	 * @param {BufferWrapper} data 
	 * @param {string} hash 
	 * @returns {object}
	 */
	async parseEncodingFile(data, hash) {
		const encodingSizes = this.encodingSizes;
		const encodingKeys = this.encodingKeys;

		const encoding = new BLTEReader(data, hash);

		const magic = encoding.readUInt16LE();
		if (magic !== ENC_MAGIC)
			throw new Error('Invalid encoding magic: ' + magic);

		encoding.move(1); // version
		const hashSizeCKey = encoding.readUInt8();
		const hashSizeEKey = encoding.readUInt8();
		const cKeyPageSize = encoding.readInt16BE() * 1024;
		encoding.move(2); // eKeyPageSize
		const cKeyPageCount = encoding.readInt32BE();
		encoding.move(4 + 1); // eKeyPageCount + unk11
		const specBlockSize = encoding.readInt32BE();

		encoding.move(specBlockSize + (cKeyPageCount * (hashSizeCKey + 16)));

		const pagesStart = encoding.offset;
		for (let i = 0; i < cKeyPageCount; i++) {
			const pageStart = pagesStart + (cKeyPageSize * i);
			encoding.seek(pageStart);

			while (encoding.offset < (pageStart + pagesStart)) {
				const keysCount = encoding.readUInt8();
				if (keysCount === 0)
					break;

				const size = encoding.readInt40BE();
				const cKey = encoding.readHexString(hashSizeCKey);

				encodingSizes.set(cKey, size);
				encodingKeys.set(cKey, encoding.readHexString(hashSizeEKey));

				encoding.move(hashSizeEKey * (keysCount - 1));
			}
		}
	}

	/**
	 * Run any necessary clean-up once a CASC instance is no longer
	 * needed. At this point, the instance must be made eligible for GC.
	 */
	cleanup() {
		this.unhookConfig();
	}

	async getItemsData(itemSlotsIgnored) {
		const progress = core.createProgress(5);

		await progress.step('Loading item data...');
		const itemSparse = new WDCReader('DBFilesClient/ItemSparse.db2');
		await itemSparse.parse();

		await progress.step('Loading item display info...');
		const itemDisplayInfo = new WDCReader('DBFilesClient/ItemDisplayInfo.db2');
		await itemDisplayInfo.parse();

		await progress.step('Loading item appearances...');
		const itemModifiedAppearance = new WDCReader('DBFilesClient/ItemModifiedAppearance.db2');
		await itemModifiedAppearance.parse();

		await progress.step('Loading item materials...');
		const itemDisplayInfoMaterialRes = new WDCReader('DBFilesClient/ItemDisplayInfoMaterialRes.db2');
		await itemDisplayInfoMaterialRes.parse();

		const itemAppearance = new WDCReader('DBFilesClient/ItemAppearance.db2');
		await itemAppearance.parse();

		await progress.step('Building item relationships...');

		const itemSparseRows = itemSparse.getAllRows();
		const items = [];

		const appearanceMap = new Map();
		for (const row of itemModifiedAppearance.getAllRows().values())
			appearanceMap.set(row.ItemID, row.ItemAppearanceID);

		const materialMap = new MultiMap();
		for (const row of itemDisplayInfoMaterialRes.getAllRows().values())
			materialMap.set(row.ItemDisplayInfoID, row.MaterialResourcesID);

		for (const [itemID, itemRow] of itemSparseRows) {
			if (itemSlotsIgnored.includes(itemRow.inventoryType))
				continue;

			const itemAppearanceID = appearanceMap.get(itemID);
			const itemAppearanceRow = itemAppearance.getRow(itemAppearanceID);

			let materials = null;
			let models = null;
			if (itemAppearanceRow !== null) {
				materials = [];
				models = [];

				const itemDisplayInfoRow = itemDisplayInfo.getRow(itemAppearanceRow.ItemDisplayInfoID);
				if (itemDisplayInfoRow !== null) {
					materials.push(...itemDisplayInfoRow.ModelMaterialResourcesID);
					models.push(...itemDisplayInfoRow.ModelResourcesID);
				}

				const materialRes = materialMap.get(itemAppearanceRow.ItemDisplayInfoID);
				if (materialRes !== undefined)
					Array.isArray(materialRes) ? materials.push(...materialRes) : materials.push(materialRes);

				materials = materials.filter(e => e !== 0);
				models = models.filter(e => e !== 0);
			}

			items.push([itemID, itemRow, itemAppearanceRow, materials, models]);
		}

		if (core.view.config.itemViewerShowAll) {
			const itemDB = new WDCReader('DBFilesClient/Item.db2');
			await itemDB.parse();

			for (const [itemID, itemRow] of itemDB.getAllRows()) {
				if (itemSlotsIgnored.includes(itemRow.inventoryType))
					continue;

				if (itemSparseRows.has(itemID))
					continue;

				const itemAppearanceID = appearanceMap.get(itemID);
				const itemAppearanceRow = itemAppearance.getRow(itemAppearanceID);

				let materials = null;
				let models = null;
				if (itemAppearanceRow !== null) {
					materials = [];
					models = [];

					const itemDisplayInfoRow = itemDisplayInfo.getRow(itemAppearanceRow.ItemDisplayInfoID);
					if (itemDisplayInfoRow !== null) {
						materials.push(...itemDisplayInfoRow.ModelMaterialResourcesID);
						models.push(...itemDisplayInfoRow.ModelResourcesID);
					}

					const materialRes = materialMap.get(itemAppearanceRow.ItemDisplayInfoID);
					if (materialRes !== undefined)
						Array.isArray(materialRes) ? materials.push(...materialRes) : materials.push(materialRes);

					materials = materials.filter(e => e !== 0);
					models = models.filter(e => e !== 0);
				}

				items.push([itemID, itemRow, null, null, null]);
			}
		}

		return items;
	}

	async getCharactersData (progress) {
		const chrModelIDToFileDataID = new Map();
		const chrModelIDToTextureLayoutID = new Map();
		const optionsByChrModel = new Map();
		const optionToChoices = new Map();
		const defaultOptions = new Array();

		const chrRaceMap = new Map();
		const chrRaceXChrModelMap = new Map();

		const choiceToGeoset = new Map();
		const choiceToChrCustMaterialID = new Map();
		const choiceToSkinnedModel = new Map();
		const unsupportedChoices = new Array();

		const geosetMap = new Map();
		const chrCustMatMap = new Map();
		const chrModelTextureLayerMap = new Map();
		const charComponentTextureSectionMap = new Map();
		const chrModelMaterialMap = new Map();
		const chrCustSkinnedModelMap = new Map();

		await progress.step('Loading character models..');
		const chrModelDB = new WDCReader('DBFilesClient/ChrModel.db2', this);
		await chrModelDB.parse();

		await progress.step('Loading character customization choices...');
		const chrCustChoiceDB = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2', this);
		await chrCustChoiceDB.parse();

		// TODO: There is so many DB2 loading below relying on fields existing, we should probably check for them first and handle missing ones gracefully.
		await progress.step('Loading character customization materials...');
		const chrCustMatDB = new WDCReader('DBFilesClient/ChrCustomizationMaterial.db2', this);
		await chrCustMatDB.parse();

		await progress.step('Loading character customization elements...');
		const chrCustElementDB = new WDCReader('DBFilesClient/ChrCustomizationElement.db2', this);
		await chrCustElementDB.parse();

		for (const chrCustomizationElementRow of chrCustElementDB.getAllRows().values()) {
			if (chrCustomizationElementRow.ChrCustomizationGeosetID != 0)
				choiceToGeoset.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationGeosetID);

			if (chrCustomizationElementRow.ChrCustomizationSkinnedModelID != 0) {
				choiceToSkinnedModel.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationSkinnedModelID);
				unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);
			}

			if (chrCustomizationElementRow.ChrCustomizationBoneSetID != 0)
				unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

			if (chrCustomizationElementRow.ChrCustomizationCondModelID != 0)
				unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

			if (chrCustomizationElementRow.ChrCustomizationDisplayInfoID != 0)
				unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

			if (chrCustomizationElementRow.ChrCustomizationMaterialID != 0) {
				if (choiceToChrCustMaterialID.has(chrCustomizationElementRow.ChrCustomizationChoiceID))
					choiceToChrCustMaterialID.get(chrCustomizationElementRow.ChrCustomizationChoiceID).push({ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID });
				else
					choiceToChrCustMaterialID.set(chrCustomizationElementRow.ChrCustomizationChoiceID, [{ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID }]);

				const matRow = chrCustMatDB.getRow(chrCustomizationElementRow.ChrCustomizationMaterialID);
				let FileDataID = DBTextureFileData.getTextureFDIDsByMatID(matRow.MaterialResourcesID);
				if (FileDataID?.length > 0)
					FileDataID = FileDataID[0];
				chrCustMatMap.set(matRow.ID, { ChrModelTextureTargetID: matRow.ChrModelTextureTargetID, FileDataID });
			}
		}

		await progress.step('Loading character customization options...');
		const chrCustOptDB = new WDCReader('DBFilesClient/ChrCustomizationOption.db2', this);
		await chrCustOptDB.parse();

		for (const [chrModelID, chrModelRow] of chrModelDB.getAllRows()) {
			const fileDataID = DBCreatures.getFileDataIDByDisplayID(chrModelRow.DisplayID);

			chrModelIDToFileDataID.set(chrModelID, fileDataID);
			chrModelIDToTextureLayoutID.set(chrModelID, chrModelRow.CharComponentTextureLayoutID);

			for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of chrCustOptDB.getAllRows()) {
				if (chrCustomizationOptionRow.ChrModelID != chrModelID)
					continue;

				const choiceList = [];

				if (!optionsByChrModel.has(chrCustomizationOptionRow.ChrModelID))
					optionsByChrModel.set(chrCustomizationOptionRow.ChrModelID, []);

				let optionName = '';
				if (chrCustomizationOptionRow.Name_lang != '')
					optionName = chrCustomizationOptionRow.Name_lang;
				else
					optionName = 'Option ' + chrCustomizationOptionRow.OrderIndex;

				optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).push({ id: chrCustomizationOptionID, label: optionName });

				for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of chrCustChoiceDB.getAllRows()) {
					if (chrCustomizationChoiceRow.ChrCustomizationOptionID != chrCustomizationOptionID)
						continue;

					// Generate name because Blizz hasn't gotten around to setting it for everything yet.
					let name = '';
					if (chrCustomizationChoiceRow.Name_lang != '')
						name = chrCustomizationChoiceRow.Name_lang;
					else
						name = 'Choice ' + chrCustomizationChoiceRow.OrderIndex;

					if (unsupportedChoices.includes(chrCustomizationChoiceID))
						name += '*';

					choiceList.push({ id: chrCustomizationChoiceID, label: name });
				}

				optionToChoices.set(chrCustomizationOptionID, choiceList);

				// If option flags does not have 0x20 ("EXCLUDE_FROM_INITIAL_RANDOMIZATION") we can assume it's a default option.
				if (!(chrCustomizationOptionRow.Flags & 0x20))
					defaultOptions.push(chrCustomizationOptionID);
			}
		}

		await progress.step('Loading character races..');
		const chrRacesDB = new WDCReader('DBFilesClient/ChrRaces.db2', this);
		await chrRacesDB.parse();

		for (const [chrRaceID, chrRaceRow] of chrRacesDB.getAllRows()) {
			const flags = chrRaceRow.Flags;
			chrRaceMap.set(chrRaceID, { id: chrRaceID, name: chrRaceRow.Name_lang, isNPCRace: ((flags & 1) == 1 && chrRaceID != 23 && chrRaceID != 75) });
		}

		await progress.step('Loading character race models..');
		const chrRaceXChrModelDB = new WDCReader('DBFilesClient/ChrRaceXChrModel.db2', this);
		await chrRaceXChrModelDB.parse();

		for (const chrRaceXChrModelRow of chrRaceXChrModelDB.getAllRows().values()) {
			if (!chrRaceXChrModelMap.has(chrRaceXChrModelRow.ChrRacesID))
				chrRaceXChrModelMap.set(chrRaceXChrModelRow.ChrRacesID, new Map());

			chrRaceXChrModelMap.get(chrRaceXChrModelRow.ChrRacesID).set(chrRaceXChrModelRow.Sex, chrRaceXChrModelRow.ChrModelID);
		}

		await progress.step('Loading character model materials..');
		const chrModelMatDB = new WDCReader('DBFilesClient/ChrModelMaterial.db2', this);
		await chrModelMatDB.parse();

		for (const chrModelMaterialRow of chrModelMatDB.getAllRows().values())
			chrModelMaterialMap.set(chrModelMaterialRow.CharComponentTextureLayoutsID + "-" + chrModelMaterialRow.TextureType, chrModelMaterialRow);

		// load charComponentTextureSection
		await progress.step('Loading character component texture sections...');
		const charComponentTextureSectionDB = new WDCReader('DBFilesClient/CharComponentTextureSections.db2', this);
		await charComponentTextureSectionDB.parse();
		for (const charComponentTextureSectionRow of charComponentTextureSectionDB.getAllRows().values()) {
			if (!charComponentTextureSectionMap.has(charComponentTextureSectionRow.CharComponentTextureLayoutID))
				charComponentTextureSectionMap.set(charComponentTextureSectionRow.CharComponentTextureLayoutID, []);

			charComponentTextureSectionMap.get(charComponentTextureSectionRow.CharComponentTextureLayoutID).push(charComponentTextureSectionRow);
		}

		await progress.step('Loading character model texture layers...');
		const chrModelTextureLayerDB = new WDCReader('DBFilesClient/ChrModelTextureLayer.db2', this);
		await chrModelTextureLayerDB.parse();
		for (const chrModelTextureLayerRow of chrModelTextureLayerDB.getAllRows().values())
			chrModelTextureLayerMap.set(chrModelTextureLayerRow.CharComponentTextureLayoutsID + "-" + chrModelTextureLayerRow.ChrModelTextureTargetID[0], chrModelTextureLayerRow);

		await progress.step('Loading character customization geosets...');
		const chrCustGeosetDB = new WDCReader('DBFilesClient/ChrCustomizationGeoset.db2', this);
		await chrCustGeosetDB.parse();

		for (const [chrCustomizationGeosetID, chrCustomizationGeosetRow] of chrCustGeosetDB.getAllRows()) {
			const geoset = chrCustomizationGeosetRow.GeosetType.toString().padStart(2, '0') + chrCustomizationGeosetRow.GeosetID.toString().padStart(2, '0');
			geosetMap.set(chrCustomizationGeosetID, Number(geoset));
		}

		await progress.step('Loading character customization skinned models...');

		const chrCustSkinnedModelDB = new WDCReader('DBFilesClient/ChrCustomizationSkinnedModel.db2', this);
		await chrCustSkinnedModelDB.parse();
		for (const [chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow] of chrCustSkinnedModelDB.getAllRows())
			chrCustSkinnedModelMap.set(chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow);

		return {
			chrModelIDToFileDataID,
			chrModelIDToTextureLayoutID,
			optionsByChrModel,
			optionToChoices,
			defaultOptions,
			chrRaceMap,
			chrRaceXChrModelMap,
			choiceToGeoset,
			choiceToChrCustMaterialID,
			choiceToSkinnedModel,
			unsupportedChoices,
			geosetMap,
			chrCustMatMap,
			chrModelTextureLayerMap,
			charComponentTextureSectionMap,
			chrModelMaterialMap,
			chrCustSkinnedModelMap,
		}
	}
}

module.exports = CASC;