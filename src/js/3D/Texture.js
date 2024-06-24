/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const listfile = require('../loader/listfile');
const core = require('../core');

class Texture {
	/**
	 * Construct a new Texture instance.
	 * @param {number} flags 
	 * @param {number} fileDataID
	 * @param {number} type
	 */
	constructor(flags, fileDataID, type) {
		this.flags = flags;
		this.fileDataID = fileDataID || 0;
		this.type = type;
	}

	/**
	 * Set the texture file using a file name.
	 * @param {string} fileName 
	 */
	setFileName(fileName) {
		this.fileDataID = listfile.getByFilename(fileName) || 0;
	}

	/**
	 * Obtain the texture file for this texture, instance cached.
	 * Returns NULL if fileDataID is not set.
	 */
	async getTextureFile() {
		if (this.fileDataID > 0) {
			if (!this.data)
				this.data = await core.view.casc.getFile(this.fileDataID);

			return this.data;
		}

		return null;
	}
}

module.exports = Texture;