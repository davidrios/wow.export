const zlib = require('zlib');
const BufferWrapper = require('../buffer');
const generics = require('../generics');

// const MPQ_FILE_IMPLODE = BigInt(0x00000100);
const MPQ_FILE_COMPRESS = BigInt(0x00000200);
const MPQ_FILE_ENCRYPTED = BigInt(0x00010000);
// const MPQ_FILE_FIX_KEY = BigInt(0x00020000);
const MPQ_FILE_SINGLE_UNIT = BigInt(0x01000000);
// const MPQ_FILE_DELETE_MARKER = BigInt(0x02000000);
// const MPQ_FILE_SECTOR_CRC = BigInt(0x04000000);
const MPQ_FILE_EXISTS = BigInt(0x80000000);

const prepareEncryptionTable = () => {
	let seed = BigInt(0x00100001);
	let temp1;
	let temp2;
	const cryptTable = {};

	for (let i = 0; i < 256; i++) {
		let index = i;
		for (let j = 0; j < 5; j++) {
			seed = (seed * BigInt(125) + BigInt(3)) % BigInt(0x2AAAAB);
			temp1 = (seed & BigInt(0xFFFF)) << BigInt(0x10);

			seed = (seed * BigInt(125) + BigInt(3)) % BigInt(0x2AAAAB);
			temp2 = (seed & BigInt(0xFFFF));

			cryptTable[index] = (temp1 | temp2);

			index += 0x100;
		}
	}

	return cryptTable
}

const encryptionTable = prepareEncryptionTable();

const HASH_TYPES = {
	TABLE_OFFSET: BigInt(0),
	HASH_A: BigInt(1),
	HASH_B: BigInt(2),
	TABLE: BigInt(3)
}

const hash = (string, hashType) => {
	let seed1 = BigInt(0x7FED7FED);
	let seed2 = BigInt(0xEEEEEEEE);
	let value;
	string = string.toUpperCase();

	for (let i = 0; i < string.length; i++) {
		const ch = BigInt(string.charCodeAt(i));
		value = encryptionTable[(HASH_TYPES[hashType] << BigInt(8)) + ch];
		seed1 = (value ^ (seed1 + seed2)) & BigInt(0xFFFFFFFF);
		seed2 = ch + seed1 + seed2 + (seed2 << BigInt(5)) + BigInt(3) & BigInt(0xFFFFFFFF);
	}

	return seed1
}

const decrypt = (data, key) => {
	data.seek(0);
	let seed1 = BigInt(key);
	let seed2 = BigInt(0xEEEEEEEE);
	let value;
	const result = BufferWrapper.alloc(data.byteLength);

	for (let i = 0; i < (data.byteLength / 4); i++) {
		seed2 += encryptionTable[BigInt(0x400) + (seed1 & BigInt(0xFF))];
		seed2 &= BigInt(0xFFFFFFFF);
		value = BigInt(data.readUInt32LE());
		value = (value ^ (seed1 + seed2)) & BigInt(0xFFFFFFFF);

		seed1 = ((~seed1 << BigInt(0x15)) + BigInt(0x11111111)) | (seed1 >> BigInt(0x0B));
		seed1 &= BigInt(0xFFFFFFFF);
		seed2 = value + seed2 + (seed2 << BigInt(5)) + BigInt(3) & BigInt(0xFFFFFFFF);

		result.writeUInt32LE(Number(value));
	}

	result.seek(0);

	return result;
}

const decompress = (data) => {
	const compressionType = data.readUInt8();
	if (compressionType === 2)
		return new BufferWrapper(zlib.inflateSync(data.readBuffer().raw))
	else if (compressionType === 16)
		throw new Error(`Bz2 compression not supported yet.`);

	throw new Error(`Unsupported compression type: ${compressionType}.`);
}

const hashTableEntry = (data) => {
	return {
		hashA: data.readUInt32LE(),
		hashB: data.readUInt32LE(),
		locale: data.readUInt16LE(),
		platform: data.readUInt16LE(),
		blockTableIndex: data.readUInt32LE(),
	}
}

const blockTableEntry = (data) => {
	return {
		offset: data.readUInt32LE(),
		archiveSize: data.readUInt32LE(),
		size: data.readUInt32LE(),
		flags: BigInt(data.readUInt32LE()),
	}
}

const hashTableKey = (hashA, hashB) => {
	return `${hashA.toString()}-${hashB.toString()}`;
}

class MPQReader {
	constructor(filePath) {
		this.filePath = filePath;
	}

	async load() {
		const headerBuf = await generics.readFile(this.filePath, 0, 0x2c);

		const magic = headerBuf.readString(4);
		if (magic !== 'MPQ\x1a') 
			throw new Error('invalid mpq file');
    
		const header = {
			magic,
			headerSize: headerBuf.readUInt32LE(),
			archiveSize: headerBuf.readUInt32LE(),
			formatVersion: headerBuf.readUInt16LE(),
			sectorShift: headerBuf.readUInt16LE(),
			hashTableOffset: headerBuf.readUInt32LE(),
			blockTableOffset: headerBuf.readUInt32LE(),
			hashTableEntries: headerBuf.readUInt32LE(),
			blockTableEntries: headerBuf.readUInt32LE(),
			extendedBlockTableOffset: null,
			hashTableOffsetHigh: null,
			blockTableOffsetHigh: null
		}

		if (header.formatVersion === 1) {
			header.extendedBlockTableOffset = headerBuf.readUInt64LE();
			header.hashTableOffsetHigh = headerBuf.readUInt16LE();
			header.blockTableOffsetHigh = headerBuf.readUInt16LE();
		}

		this.header = header;

		this.hashTable = await this._readTable('hash');
		this.blockTable = await this._readTable('block');
	}

	async _readTable(tableType) {
		if (tableType !== 'hash' && tableType !== 'block')
			throw new Error("Invalid table type.");

		const tableOffset = this.header[`${tableType}TableOffset`];
		const tableEntries = this.header[`${tableType}TableEntries`];
		const key = hash(`(${tableType} table)`, 'TABLE');

		const data = decrypt(
			await generics.readFile(this.filePath, tableOffset, tableEntries * 16),
			key
		);

		if (tableType === 'hash') {
			const res = {};
			for (let i = 0; i < tableEntries; i++) {
				data.seek(i * 16);
				const entry = hashTableEntry(data.readBuffer(16));
				res[hashTableKey(entry.hashA, entry.hashB)] = entry;
			}
			return res;
		} else {
			const res = [];
			for (let i = 0; i < tableEntries; i++) {
				data.seek(i * 16);
				res.push(blockTableEntry(data.readBuffer(16)));
			}
			return res;
		}
	}

	getHashTableEntry(filename) {
		const hashA = hash(filename, 'HASH_A');
		const hashB = hash(filename, 'HASH_B');
		return this.hashTable[hashTableKey(hashA, hashB)];
	}

	async readFile(filename) {
		const hashEntry = this.getHashTableEntry(filename);
		if (hashEntry == null)
			throw new Error('Filename not found in hash table.');

		const blockEntry = this.blockTable[hashEntry.blockTableIndex]

		if ((blockEntry.flags & MPQ_FILE_EXISTS) !== MPQ_FILE_EXISTS)
			throw new Error("Block doesn't have MPQ_FILE_EXISTS flag");

		if (blockEntry.archiveSize === 0)
			return BufferWrapper.alloc(0);

		let fileData = await generics.readFile(this.filePath, blockEntry.offset, blockEntry.archiveSize);

		if ((blockEntry.flags & MPQ_FILE_ENCRYPTED) === MPQ_FILE_ENCRYPTED)
			throw new Error('Encryption is not supported yet.');

		const isCompressed = (blockEntry.flags & MPQ_FILE_COMPRESS) === MPQ_FILE_COMPRESS;

		if ((blockEntry.flags & MPQ_FILE_SINGLE_UNIT) === MPQ_FILE_SINGLE_UNIT) {
			if (isCompressed && blockEntry.size > blockEntry.archiveSize)
				fileData = decompress(fileData);

			return fileData;
		}

		const sectorSize = BigInt(512) << BigInt(this.header.sectorShift);
		let sectors = Number(BigInt(blockEntry.size) / sectorSize) + 1;

		const positions = [];
		for (let i = 0; i < sectors + 1; i++)
			positions.push(fileData.readUInt32LE());
		
		const result = BufferWrapper.alloc(blockEntry.size);
		for (let i = 0; i < sectors; i++) {
			fileData.seek(positions[i]);
			let sector = fileData.readBuffer(positions[i + 1] - positions[i]);
			if (isCompressed && sector.byteLength > 0)
				sector = decompress(sector);

			result.writeBuffer(sector);
		}

		result.seek(0);
		return result;
	}

	async getFileList() {
		return (await this.readFile('(listfile)')).readString().split(/[\r\n;]+/);
	}
}

module.exports = MPQReader;