const BufferWrapper = require('../buffer');
const BLTEReader = require('./blte-reader');
const listfile = require('./listfile');
const log = require('../log');
const core = require('../core');
const LocaleFlag = require('./locale-flags');
const ContentFlag = require('./content-flags');

const ENC_MAGIC = 0x4E45;
const ROOT_MAGIC = 0x4D465354;

class CASC {
	constructor() {
		this.encodingSizes = new Map();
		this.encodingKeys = new Map();
		this.rootTypes = [];
		this.rootEntries = new Map();

		// Listen for configuration changes to cascLocale.
		this.unhookConfig = core.view.$watch('cascLocale', (locale) => {
			if (!isNaN(locale)) {
				this.locale = locale;
			} else {
				log.write('Invalid locale set in configuration, defaulting to enUS');
				this.locale = LocaleFlag.enUS;
			}
		}, { immediate: true });
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
			// ToDo: Potentially allow users to fine-tune these flags more directly in config.
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
	 * Obtain a file by a filename.
	 * fileName must exist in the loaded listfile.
	 * @param {string} fileName 
	 */
	async getFileByName(fileName) {
		const fileDataID = listfile.getByFilename(fileName);
		if (fileDataID === undefined)
			throw new Error('File not mapping in listfile: %s', fileName);

		return await this.getFile(fileDataID);
	}

	/**
	 * Load the listfile for selected build.
	 * @param {string} buildKey 
	 */
	async loadListfile(buildKey) {
		await this.progress.step('Loading listfile');
		const entries = await listfile.loadListfile(buildKey, this.cache);
		if (entries === 0)
			throw new Error('No listfile entries found');

		// Pre-filter extensions for tabs.
		await this.progress.step('Filtering listfiles');
		core.view.listfileTextures = listfile.getFilenamesByExtension('.blp');
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
		if (magic !== ROOT_MAGIC)
			throw new Error('Invalid root magic: ' + magic);
		
		const totalFileCount = root.readUInt32LE();
		const namedFileCount = root.readUInt32LE();
		const allowNamelessFiles = totalFileCount !== namedFileCount;

		const rootTypes = this.rootTypes;
		const rootEntries = this.rootEntries;
	
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

			// Push the rootType after the parsing the block so that
			// rootTypes.length can be used for the type index above.
			rootTypes.push({ contentFlags, localeFlags });
		}

		return totalFileCount;
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
}

module.exports = CASC;