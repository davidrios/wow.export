const path = require('path');

const listfile = require('/js/casc/listfile');
const BLPFile = require('../casc/blp');
const ExportHelper = require('/js/casc/export-helper');
const JSONWriter = require('/js/3D/writers/JSONWriter');
const { getGeosetName } = require('/js/3D/GeosetMapper');
const DBTextureFileData = require('/js/db/caches/DBTextureFileData');
const DBModelFileData = require('/js/db/caches/DBModelFileData');
const TabModels = require('/js/ui/tab-models');

import loadData from './creatures/game-data.mjs';
import loadUiState from './creatures/ui-state.mjs';
import { TableDisplay } from './creatures/components.mjs';
import loadCharacterData from './characters/game-data.mjs';

const { ref, computed, inject, provide } = Vue;

function objFilterFields(obj, fields, isBlacklist) {
	fields = new Set(fields);
	return Object.fromEntries(
		Object.entries(obj)
			.filter(([key]) => isBlacklist ? !fields.has(key) : fields.has(key))
	);
}

export default {
	components: { TableDisplay },
	setup() {
		const view = inject('view');

		const isLoaded = ref(false);
		const isBusy = ref(false);
		const uiState = loadUiState(view);

		const {
			creaturesFilter,
			creaturesSelection,
			selectedDisplayInfo,
			selectedSoundKit,
		} = uiState;

		let creatures;

		let d;
		let cd;
		// setup can't be async, so this needs to be scheduled like this
		(async function () {
			cd = await loadCharacterData(view, true);
			d = await loadData(view);
			view.setScreen('tab-creatures');

			creatures = Array.from(d.creaturetemplate.values()).map(entry => {
				const name = new String(`${entry.name} (${entry.id})`);
				name.id = entry.id;
				return name;
			})

			if (creaturesSelection.value.length > 0)
				creaturesSelection.value = creatures.filter(entry => entry.id === creaturesSelection.value[0].id);

			window._aaa = d;
			window._bbb = cd;
			isLoaded.value = d != null;
		})();

		const sortedCreatures = computed(() => {
			if (parseInt(creaturesFilter.value).toString() === creaturesFilter.value)
				return creatures.sort((a, b) => a.id === b.id ? 0 : (a.id < b.id ? -1 : 1));
			else
				return creatures.sort((a, b) => a.localeCompare(b));
		})

		function loadSelected(creatureId) {
			selectedSoundKit.value = null;

			if (creatureId == null)
				return;

			const info = d.creaturetemplate.get(selectedCreatureId.value);
			if (info != null)
				selectedDisplayInfo.value = info.modelid1;
		}

		const selectedCreatureId = computed(() => {
			const selected = creaturesSelection.value[0];
			if (selected == null)
				return;

			return selected.id;
		})

		const selectedData = computed(() => {
			const info = d.creaturetemplate.get(selectedCreatureId.value);
			if (info == null)
				return null;

			var equiptemplate = d.creatureequiptemplate.get(info.entry) ?? {};
			const items = equiptemplate.items
				?.filter(item => item.displayid != null)
				.map(item => objFilterFields(item, ['entry', 'class', 'subclass', 'name', 'displayid', 'Material', 'sheath', 'index'])) ?? [];

			const creaturedisplayinfo = d.creaturedisplayinfo.getRow(selectedDisplayInfo.value ?? info.modelid1);
			if (creaturedisplayinfo == null)
				return null;

			const creaturedisplayinfoextra = d.creaturedisplayinfoextra.getRow(creaturedisplayinfo.ExtendedDisplayInfoID);

			const modeldata = d.creaturemodeldata.getRow(creaturedisplayinfo.ModelID);
			const sounddata = d.creaturesounddata.getRow(modeldata.SoundID);
			return {
				info: objFilterFields(info, ['entry', 'modelid1', 'modelid2', 'modelid3', 'modelid4', 'name', 'subname', 'scale', 'unity_class', 'MovementType']),
				items,
				creaturedisplayinfo,
				creaturedisplayinfoextra,
				modeldata,
				sounddata,
			}
		})

		provide('showSoundKit', function showSoundKit(id) {
			selectedSoundKit.value = id;
		});

		provide('selectDisplayInfo', function selectDisplayInfo(id) {
			selectedDisplayInfo.value = id;
		});

		const soundKit = computed(() => d.soundkit.getRow(selectedSoundKit.value));
		const soundKitEntries = computed(() => d.soundkitentrymap.get(selectedSoundKit.value));

		const npcItemSlotEntries = computed(() =>
			selectedData.value.creaturedisplayinfoextra == null
				? null
				: d.npcmodelitemslotdisplayinfomap.get(selectedData.value.creaturedisplayinfoextra.ID)
		);

		const itemDisplayInfo = computed(() => {
			const equipMap = {};
			for (const entry of selectedData.value?.items ?? [])
				equipMap[entry.displayid] = d.itemdisplayinfo.getRow(entry.displayid);

			for (const entry of npcItemSlotEntries.value ?? [])
				equipMap[entry.ItemDisplayInfoID] = d.itemdisplayinfo.getRow(entry.ItemDisplayInfoID);

			return equipMap;
		});

		function getCustChoices(creaturedisplayinfoextra) {
			const race = creaturedisplayinfoextra.DisplayRaceID;
			const sex = creaturedisplayinfoextra.DisplaySexID;
			const chosenOptions = new Map(
				d.creaturedisplayinfooptionmap.get(creaturedisplayinfoextra.ID)
					.map(entry => [entry.ChrCustomizationOptionID, entry.ChrCustomizationChoiceID])
			);

			const model = cd.chrRaceXChrModelMap.get(race).get(sex);
			const availableOptions = cd.optionsByChrModel.get(model);
			const allChoices = new Map();
			for (const option of availableOptions) {
				if (!allChoices.has(option.id))
					allChoices.set(option.id, new Map());

				for (const choice of cd.optionToChoices.get(option.id))
					allChoices.get(option.id).set(choice.id, {...choice, customizationID: option.customizationID});
			}

			const ret = new Map();
			for (const [optionID, choice] of chosenOptions.entries()) {
				const choiceVal = allChoices.get(optionID).get(choice);
				ret.set(choiceVal.customizationID, {...choiceVal, optionID});
			}

			return ret;
		}

		function calculateEnabledGeosets(creaturedisplayinfoextra) {
			if (creaturedisplayinfoextra == null)
				return null;

			const custChoices = getCustChoices(creaturedisplayinfoextra);

			const enabled = [];

			for (const choice of custChoices.values()) {
				for (const chrCustGeoID of cd.choiceToGeoset.get(choice.id) ?? []) {
					const geoset = cd.geosetMap.get(chrCustGeoID);
					if (geoset != null)
						enabled.push(getGeosetName(geoset, geoset));
				}
			}

			const itemBySlot = new Map();
			for (const itemSlot of Object.values(npcItemSlotEntries.value))
				itemBySlot.set(itemSlot.ItemSlot, itemDisplayInfo.value[itemSlot.ItemDisplayInfoID]);

			if (itemBySlot.has(2)) {
				if (itemBySlot.get(2).GeosetGroup[0] > 0)
					enabled.push(`Wrist${itemBySlot.get(2).GeosetGroup[0] + 1}`);
			}

			const chestSlot = itemBySlot.get(5);
			if (chestSlot != null) {
				if (chestSlot.GeosetGroup[0] > 0)
					enabled.push(`Tabard${chestSlot.GeosetGroup[0] + 1}`);

				if (chestSlot.GeosetGroup[2] > 0) {
					enabled.push(`Trousers${chestSlot.GeosetGroup[2] + 1}`);
					enabled.push('-Boots1');
				}
			}

			if (itemBySlot.has(6)) {
				if (itemBySlot.get(6).GeosetGroup[0] > 0)
					enabled.push(`Boots${itemBySlot.get(6).GeosetGroup[0] + 1}`);
			}

			if (itemBySlot.has(8)) {
				if (itemBySlot.get(8).GeosetGroup[0] > 0)
					enabled.push(`Gloves${itemBySlot.get(8).GeosetGroup[0] + 1}`);
			}

			return enabled;
		}

		const enabledGeosets = computed(() => calculateEnabledGeosets(selectedData.value.creaturedisplayinfoextra));

		async function exportSelected() {
			const id = selectedCreatureId.value;
			const data = selectedData.value;

			const extraExports = new Set();
			function addToExport(file) {
				extraExports.add(file);
				if (file.endsWith('.blp'))
					file = file.replace(/\.blp$/, '.png');
				return file;
			}

			const extraExportModels = new Map();
			function addToExportModel(modelFile, textureID) {
				if (!view.config.creaturesExportEquip || modelFile == null || textureID == null)
					return modelFile;

				extraExportModels.set(modelFile, textureID);
				return modelFile;
			}

			const displayInfo = {};
			const soundKits = {};

			var equiptemplate = d.creatureequiptemplate.get(id) ?? {};
			const equipItems = equiptemplate.items
				?.filter(item => item.displayid != null)
				.map(item => ({
					...item,
					ItemDisplayInfoID: item.displayid,
					ItemSlot: item.class + 100,
				})) ?? [];

			for (let i = 1; i <= 4; i++) {
				const displayInfoId = data.info[`modelid${i}`];
				const creaturedisplayinfo = d.creaturedisplayinfo.getRow(displayInfoId);
				if (creaturedisplayinfo == null)
					continue;

				const creaturedisplayinfoextra = d.creaturedisplayinfoextra.getRow(creaturedisplayinfo.ExtendedDisplayInfoID);
				const modeldata = d.creaturemodeldata.getRow(creaturedisplayinfo.ModelID);
				const modelsounddata = d.creaturesounddata.getRow(modeldata.SoundID);

				const itemSlots = {};
				const itemEntries = equipItems.concat(d.npcmodelitemslotdisplayinfomap.get(creaturedisplayinfoextra?.ID) ?? []);

				for (const entry of itemEntries) {
					const displayInfo = d.itemdisplayinfo.getRow(entry.ItemDisplayInfoID);

					const ModelMaterialResourcesIDFileIDs = displayInfo.ModelMaterialResourcesID.map(
						(id, idx) => id === 0 ? id : DBTextureFileData.getTextureFDIDsByMatID(id)[idx]);

					// if other textures are blank, copy first texture if it exists
					for (let i = 1; i < ModelMaterialResourcesIDFileIDs.length; i++) {
						if (ModelMaterialResourcesIDFileIDs[i] == null && ModelMaterialResourcesIDFileIDs[0] > 0)
							ModelMaterialResourcesIDFileIDs[i] = ModelMaterialResourcesIDFileIDs[0];
					}

					const ModelResourcesIDFileIDs = displayInfo.ModelResourcesID.map(
						(id, idx) => id === 0 ? id : DBModelFileData.getModelFileDataID(id)[idx]);

					itemSlots[entry.ItemSlot] = {
						...entry,
						displayInfo: {
							...displayInfo,
							ModelMaterialResourcesIDFileIDs,
							ModelMaterialResourcesIDFiles: ModelMaterialResourcesIDFileIDs.map(id => id > 0 ? addToExport(listfile.getByID(id)) : 0),
							ModelResourcesIDFileIDs,
							ModelResourcesIDFiles: ModelResourcesIDFileIDs.map(
								(id, idx) => addToExportModel(listfile.getByID(id), ModelMaterialResourcesIDFileIDs[idx])),
						}
					};
				}

				const locDisplayInfo = displayInfo[displayInfoId] = {
					...creaturedisplayinfo,
					TextureVariationFileData: creaturedisplayinfo.TextureVariationFileDataID
						.filter(id => id !== 0)
						.map(id => addToExport(listfile.getByID(id))),
					extra: {...creaturedisplayinfoextra},
					itemSlots,
					geosets: calculateEnabledGeosets(creaturedisplayinfoextra),
					model: {
						...modeldata,
						FileData: listfile.getByID(modeldata.FileDataID),
						sound: modelsounddata ?? {}
					},
				};

				if (locDisplayInfo.extra.BakeMaterialResourcesID > 0) {
					locDisplayInfo.extra.BakeMaterialResourcesIDFileID = DBTextureFileData.getTextureFDIDsByMatID(locDisplayInfo.extra.BakeMaterialResourcesID)[0];
					locDisplayInfo.extra.BakeMaterialResourcesIDFile = addToExport(listfile.getByID(locDisplayInfo.extra.BakeMaterialResourcesIDFileID));
				}

				if (creaturedisplayinfoextra != null) {
					const custChoices = new Map(Array.from(getCustChoices(creaturedisplayinfoextra).values()).map(entry => [entry.id, entry]));

					let hairTextureFile;
					let hairTextureID;

					for (const custChoice of custChoices.values()) {
						for (const custMat of cd.choiceToChrCustMaterialID.get(custChoice.id) ?? []) {
							const related = custChoices.get(custMat.RelatedChrCustomizationChoiceID);
							if (related == null)
								continue;

							const textureName = listfile.getByID(cd.chrCustMatMap.get(custMat.ChrCustomizationMaterialID).FileDataID);
							if (textureName.includes('/hair0')) {
								hairTextureFile = textureName;
								hairTextureID = listfile.getByFilename(textureName);
							}
						}
					}

					if (hairTextureFile != null) {
						locDisplayInfo.extra.HairTextureFileID = hairTextureID;
						locDisplayInfo.extra.HairTextureFile = addToExport(hairTextureFile);
					}
				}

				for (const name in view.config.creaturesSelectedSoundKitKeys) {
					if (!view.config.creaturesSelectedSoundKitKeys[name] || modelsounddata == null || modelsounddata[name] == null)
						continue;

					let ids = [];
					if (name.endsWith('ID'))
						ids = [modelsounddata[name]];
					else
						ids = modelsounddata[name].filter(id => id !== 0);

					for (const id of ids) {
						const entries = d.soundkitentrymap.get(id);
						if (entries == null)
							continue;

						soundKits[id] = {
							...d.soundkit.getRow(id),
							entries: entries.map(entry => ({...entry, FileData: addToExport(listfile.getByID(entry.FileDataID))}))
						}
					}
				}
			}

			const helper = new ExportHelper(1 + extraExports.size + extraExportModels.size, 'creature-data');
			helper.start();

			const overwriteFiles = view.config.overwriteFiles;

			const jsonOut = ExportHelper.getExportPath(`creature_data/${id}.json`);
			const json = new JSONWriter(jsonOut);

			json.addProperty('info', data.info);
			json.addProperty('displayInfo', displayInfo);
			json.addProperty('soundKit', soundKits);

			await json.write(overwriteFiles);
			helper.mark(jsonOut, true);

			for (const file of extraExports) {
				const ext = path.extname(file).toLowerCase();
				let exportPath = ExportHelper.getExportPath(file);
				const fileData = await view.casc.getFileByName(file);

				if (ext === '.blp') {
					exportPath = ExportHelper.replaceExtension(exportPath, '.png');
					const blp = new BLPFile(fileData);
					await blp.saveToPNG(exportPath, view.config.exportChannelMask);
				} else {
					fileData.writeToFile(exportPath);
				}

				helper.mark(file, true);
			}

			for (const [modelFile, textureFileID] of extraExportModels.entries()) {
				await TabModels.exportFiles([modelFile], false, -1, {
					helper,
					format: 'OBJ',
					variantTextureIDs: [textureFileID],
					overwriteFiles: false
				})
			}

			helper.finish();
		}

		return {
			config: view.config,
			isLoaded,
			isBusy,
			sortedCreatures,
			selectedData,
			soundKit,
			soundKitEntries,
			npcItemSlotEntries,
			itemDisplayInfo,
			enabledGeosets,
			...uiState,
			loadSelected,
			exportSelected
		};
	},
	template: `
		<div class="tab list-tab" id="tab-creatures" v-if="isLoaded">
			<div class="list-container">
				<listbox
					v-model:selection="creaturesSelection" :items="sortedCreatures" :filter="creaturesFilter" unittype="creature"
					:single="true" :regex="config.regexFilters" :pasteselection="config.pasteSelection"
					@update:selection="loadSelected($event[0]?.id)"
				></listbox>
			</div>
			<div class="filter">
				<input type="text" v-model="creaturesFilter" placeholder="Search creatures..." />
			</div>
			<div class="preview-container" v-if="selectedData != null">
				<div>
					<h3>Info</h3>
					<table-display type='info' :data="selectedData.info"></table-display>

					<div>
						<h3>Equipped Items</h3>
						<ul class="table-entries">
							<li v-for="entry in selectedData.items">
								<table-display type='items' :data="entry"></table-display>
								<table-display type='itemdisplayinfo' :data="itemDisplayInfo[entry.displayid]"></table-display>
							</li>
						</ul>
					</div>
				</div>
				<div>
					<h3>DisplayInfo</h3>
					<table-display type='displayinfo' :data="selectedData.creaturedisplayinfo"></table-display>

					<div v-if="selectedData.creaturedisplayinfoextra">
						<h3>DisplayInfoExtra</h3>
						<table-display type='displayinfoextra' :data="selectedData.creaturedisplayinfoextra"></table-display>
					</div>

					<div v-if="npcItemSlotEntries && npcItemSlotEntries.length > 0">
						<h3>NPCItemSlots</h3>
						<ul class="table-entries">
							<li v-for="entry in npcItemSlotEntries">
								<table-display type='npcmodelitemslotdisplayinfo' :data="entry"></table-display>
								<table-display type='itemdisplayinfo' :data="itemDisplayInfo[entry.ItemDisplayInfoID]"></table-display>
							</li>
						</ul>
					</div>
				</div>
				<div>
					<h3>ModelData</h3>
					<table-display type='modeldata' :data="selectedData.modeldata"></table-display>

					<div>
						<h3>Enabled Geosets</h3>
						<div>{{ enabledGeosets }}</div>
					</div>
				</div>
				<div>
					<h3>SoundData</h3>
					<table-display type='sounddata' :data="selectedData.sounddata"></table-display>
				</div>
				<div>
					<template v-if="soundKitEntries != null">
						<h3>SoundKitEntries</h3>
						<ul class="table-entries" v-if="soundKitEntries.length > 0">
							<li v-for="entry in soundKitEntries">
								<table-display type='soundkitentry' :data="entry"></table-display>
							</li>
						</ul>
						<p v-else>No entries.</p>

						<h3>SoundKit</h3>
						<table-display type='soundkit' :data="soundKit"></table-display>
					</template>
					<p v-else>Click on a sound ID...</p>
				</div>
			</div>
			<div class="preview-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="config.creaturesExportEquip" />
					<span>Export equipment OBJ</span>
				</label>
				<input type="button" value="Export" @click="exportSelected" :class="{ disabled: isBusy || selectedData == null }" />
			</div>
		</div>
	`
}