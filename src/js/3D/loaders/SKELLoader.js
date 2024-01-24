/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const CHUNK_SKB1 = 0x31424B53;

import { M2Track, read_m2_track, read_m2_array } from './M2Loader';

class SKELLoader {
	/**
	 * Construct a new SKELLoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
		this.chunk_ofs = 0;
	}

	/**
	 * Load the skeleton file.
	 */
	async load() {
		// Prevent multiple loading of the same file.
		if (this.isLoaded === true)
			return;

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;
	
			switch (chunkID) {
				case CHUNK_SKB1: this.parseChunk_SKB1(chunkSize); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		this.isLoaded = true;
	}

	/**
	 * Parse SKB1 chunk for skin file data IDs.
	 */
	parseChunk_SKB1() {
		const data = this.data;
		const chunk_ofs = data.offset;
		this.chunk_ofs = data.offset;

		const bone_count = data.readUInt32LE();
		const bone_ofs = data.readUInt32LE();

		const base_ofs = data.offset;

		data.seek(this.chunk_ofs + bone_ofs);

		const bones = this.bones = Array(bone_count);
		for (let i = 0; i < bone_count; i++) {
			const b_boneID = data.readInt32LE();
			const b_flags = data.readUInt32LE();
			const b_parentBone = data.readInt16LE();
			const b_subMeshID = data.readUInt16LE();
			const b_boneNameCRC = data.readUInt32LE();
			const b_translation = read_m2_track(data, chunk_ofs, () => data.readFloatLE(3));
			const b_rotation = read_m2_track(data, chunk_ofs, () => data.readUInt16LE(4).map(e => (e / 65565) - 1));
			const b_scale = read_m2_track(data, chunk_ofs, () => data.readFloatLE(3));
			const b_pivot = data.readFloatLE(3);

			const bone = {
				boneID: b_boneID,
				flags: b_flags,
				parentBone: b_parentBone,
				subMeshID: b_subMeshID,
				boneNameCRC: b_boneNameCRC,
				translation: b_translation,
				rotation: b_rotation,
				scale: b_scale,
				pivot: b_pivot
			};

			// Convert bone transformations coordinate system.
			const translations = bone.translation.values;
			const rotations = bone.rotation.values;
			const scale = bone.scale.values;
			const pivot = bone.pivot;

			for (let i = 0; i < translations.length; i += 3) {
				const dx = translations[i];
				const dy = translations[i + 1];
				const dz = translations[i + 2];
				translations[i] = dx;
				translations[i + 2] = dy * -1;
				translations[i + 1] = dz;
			}

			for (let i = 0; i < rotations.length; i += 4) {
				const dx = rotations[i];
				const dy = rotations[i + 1];
				const dz = rotations[i + 2];
				const dw = rotations[i + 3];

				rotations[i] = dx;
				rotations[i + 2] = dy * -1;
				rotations[i + 1] = dz;
				rotations[i + 3] = dw;
			}

			for (let i = 0; i < scale.length; i += 3) {
				const dx = scale[i];
				const dy = scale[i + 1];
				const dz = scale[i + 2];
				scale[i] = dx;
				scale[i + 2] = dy * -1;
				scale[i + 1] = dz;
			}

			{
				const pivotX = pivot[0];
				const pivotY = pivot[1];
				const pivotZ = pivot[2];
				pivot[0] = pivotX;
				pivot[2] = pivotY * -1;
				pivot[1] = pivotZ;
			}

			bones[i] = bone;
		}

		data.seek(base_ofs);
	}
}

module.exports = SKELLoader;