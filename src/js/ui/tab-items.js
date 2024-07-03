/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');

const DBModelFileData = require('../db/caches/DBModelFileData');
const DBTextureFileData = require('../db/caches/DBTextureFileData');

const ItemSlot = require('../wow/ItemSlot');

const ITEM_SLOTS_IGNORED = [0, 18, 11, 12, 24, 25, 27, 28];

const ITEM_SLOTS_MERGED = {
	'Head': [1],
	'Neck': [2],
	'Shoulder': [3],
	'Shirt': [4],
	'Chest': [5, 20],
	'Waist': [6],
	'Legs': [7],
	'Feet': [8],
	'Wrist': [9],
	'Hands': [10],
	'One-hand': [13],
	'Off-hand': [14, 22, 23],
	'Two-hand': [17],
	'Main-hand': [21],
	'Ranged': [15, 26],
	'Back': [16],
	'Tabard': [19]
};

class Item {
	/**
	 * Construct a new Item instance.
	 * @param {number} id 
	 * @param {object} itemSparseRow 
	 * @param {?object} itemAppearanceRow
	 * @param {?Array} textures
	 * @param {?Array} models
	 */
	constructor(id, itemSparseRow, itemAppearanceRow, textures, models) {
		this.id = id;
		this.name = itemSparseRow.Display_lang;

		if (this.name === undefined)
			this.name = "Unknown item #" + id;

		this.inventoryType = itemSparseRow.InventoryType;
		this.quality = itemSparseRow.OverallQualityID ?? 0;

		this.icon = itemAppearanceRow?.DefaultIconFileDataID ?? 0;

		if (this.icon == 0)
			this.icon = itemSparseRow.IconFileDataID;

		this.models = models;
		this.textures = textures;

		this.modelCount = this.models?.length ?? 0;
		this.textureCount = this.textures?.length ?? 0;
	}

	/**
	 * Returns item slot name for this items inventory type.
	 * @returns {string}
	 */
	get itemSlotName() {
		return ItemSlot.getSlotName(this.inventoryType);
	}

	/**
	 * Returns the display name for this item entry.
	 */
	get displayName() {
		return this.name + ' (' + this.id + ')';
	}
}

/**
 * Switches to the model viewer, selecting the models for the given item.
 * @param {object} item 
 */
const viewItemModels = (item) => {
	core.view.setScreen('tab-models');

	const list = new Set();

	for (const modelID of item.models) {
		const fileDataIDs = DBModelFileData.getModelFileDataID(modelID);
		for (const fileDataID of fileDataIDs) {
			let entry = core.view.casc.listfile.getByID(fileDataID);

			if (entry !== undefined) {
				if (core.view.config.listfileShowFileDataIDs)
					entry += ' [' + fileDataID + ']';

				list.add(entry);
			}
		}
	}

	// Reset the user filter for models.
	core.view.userInputFilterModels = '';
	
	core.view.overrideModelList = [...list];
	core.view.selectionModels = [...list];
	core.view.overrideModelName = item.name;
};

/**
 * Switches to the texture viewer, selecting the models for the given item.
 * @param {object} item 
 */
const viewItemTextures = (item) => {
	core.view.setScreen('tab-textures');

	const list = new Set();

	for (const textureID of item.textures) {
		const fileDataIDs = DBTextureFileData.getTextureFDIDsByMatID(textureID);
		for (const fileDataID of fileDataIDs) {
			let entry = core.view.casc.listfile.getByID(fileDataID);

			if (entry !== undefined) {
				if (core.view.config.listfileShowFileDataIDs)
					entry += ' [' + fileDataID + ']';

				list.add(entry);
			}
		}
	}

	// Reset the user filter for textures.
	core.view.userInputFilterTextures = '';
	
	core.view.overrideTextureList = [...list];
	core.view.selectionTextures = [...list];
	core.view.overrideTextureName = item.name;
};

core.events.once('screen-tab-items', async () => {
	// Initialize a loading screen.
	core.view.setScreen('loading');
	core.view.isBusy++;

	const items = (await core.view.casc.getItemsData(ITEM_SLOTS_IGNORED))
		.map(item => Object.freeze(new Item(...item)))

	// Show the item viewer screen.
	core.view.loadPct = -1;
	core.view.isBusy--;
	core.view.setScreen('tab-items');

	// Load initial configuration for the type control from config.
	const enabledTypes = core.view.config.itemViewerEnabledTypes;
	const mask = [];

	for (const label of Object.keys(ITEM_SLOTS_MERGED))
		mask.push({ label, checked: enabledTypes.includes(label) });

	// Register a watcher for the item type control.
	core.view.$watch('itemViewerTypeMask', () => {
		// Refilter the listfile based on what the new selection.
		const filter = core.view.itemViewerTypeMask.filter(e => e.checked);
		const mask = [];

		filter.forEach(e => mask.push(...ITEM_SLOTS_MERGED[e.label]));
		const test = items.filter(item => mask.includes(item.inventoryType));
		core.view.listfileItems = test;

		// Save just the names of user enabled types, preventing incompatibilities if we change things.
		core.view.config.itemViewerEnabledTypes = core.view.itemViewerTypeMask.map(e => e.label);
	}, { deep: true });

	core.view.itemViewerTypeMask = mask;
});

module.exports = { viewItemModels, viewItemTextures };