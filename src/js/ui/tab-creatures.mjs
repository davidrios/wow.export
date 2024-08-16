const path = require('path');

const listfile = require('/js/casc/listfile');
const BLPFile = require('../casc/blp');
const ExportHelper = require('/js/casc/export-helper');
const JSONWriter = require('/js/3D/writers/JSONWriter');
const { getGeosetName } = require('/js/3D/GeosetMapper');
const DBTextureFileData = require('/js/db/caches/DBTextureFileData');
const DBModelFileData = require('/js/db/caches/DBModelFileData');

import loadData from './creatures/game-data.mjs';
import loadUiState from './creatures/ui-state.mjs';
import { TableDisplay } from './creatures/components.mjs';
import loadCharacterData from './characters/game-data.mjs';

const { ref, computed, inject, provide } = Vue;

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

			const creaturedisplayinfo = d.creaturedisplayinfo.getRow(selectedDisplayInfo.value ?? info.modelid1);
			if (creaturedisplayinfo == null)
				return null;

			const creaturedisplayinfoextra = d.creaturedisplayinfoextra.getRow(creaturedisplayinfo.ExtendedDisplayInfoID);

			const modeldata = d.creaturemodeldata.getRow(creaturedisplayinfo.ModelID);
			const sounddata = d.creaturesounddata.getRow(modeldata.SoundID);
			return {
				info,
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
			if (npcItemSlotEntries.value == null)
				return null;

			return Object.fromEntries(npcItemSlotEntries.value.map(entry => [entry.ItemDisplayInfoID, d.itemdisplayinfo.getRow(entry.ItemDisplayInfoID)]));
		});

		function calculateEnabledGeosets(creaturedisplayinfoextra) {
			if (creaturedisplayinfoextra == null)
				return null;

			const race = creaturedisplayinfoextra.DisplayRaceID;
			const sex = creaturedisplayinfoextra.DisplaySexID;

			const model = cd.chrRaceXChrModelMap.get(race).get(sex);
			const availableOptions = cd.optionsByChrModel.get(model);
			const choices = new Map();
			for (const option of availableOptions) {
				if (!choices.has(option.customizationID))
					choices.set(option.customizationID, new Map());

				for (const choice of cd.optionToChoices.get(option.id))
					choices.get(option.customizationID).set(choice.orderIndex, choice);
			}

			console.log(choices);
			const hairStyle = choices.get(3).get(creaturedisplayinfoextra.HairStyleID);
			const facialHair = choices.get(5)?.get(creaturedisplayinfoextra.FacialHairID);
			const features = choices.get(14)?.get(creaturedisplayinfoextra.FacialHairID);

			const enabled = [];

			for (const opt of [hairStyle, facialHair, features]) {
				if (opt == null)
					continue;

				const chrCustGeoID = cd.choiceToGeoset.get(opt.id);
				let geoset = cd.geosetMap.get(chrCustGeoID);
				if (geoset >= 200 && geoset < 300)
					geoset = geoset - 98;

				enabled.push(getGeosetName(geoset, geoset));
				console.log(chrCustGeoID, geoset, getGeosetName(geoset, geoset));
			}

			const itemBySlot = new Map();
			for (const itemSlot of Object.values(npcItemSlotEntries.value))
				itemBySlot.set(itemSlot.ItemSlot, itemDisplayInfo.value[itemSlot.ItemDisplayInfoID]);

			if (itemBySlot.has(2)) {
				if (itemBySlot.get(2).GeosetGroup[0] > 0)
					enabled.push(`Wrist${itemBySlot.get(2).GeosetGroup[0] + 1}`);
			}

			if (itemBySlot.has(5)) {
				const chest = itemBySlot.get(5);
				if (chest.GeosetGroup[2] > 0) {
					enabled.push(`Trousers${chest.GeosetGroup[2] + 1}`);
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
				return file;
			}

			const displayInfo = {};
			const soundKits = {};

			for (let i = 1; i <= 4; i++) {
				const displayInfoId = data.info[`modelid${i}`];
				const creaturedisplayinfo = d.creaturedisplayinfo.getRow(displayInfoId);
				if (creaturedisplayinfo == null)
					continue;

				const creaturedisplayinfoextra = d.creaturedisplayinfoextra.getRow(creaturedisplayinfo.ExtendedDisplayInfoID);
				const modeldata = d.creaturemodeldata.getRow(creaturedisplayinfo.ModelID);
				const modelsounddata = d.creaturesounddata.getRow(modeldata.SoundID);

				const itemSlots = {};
				for (const entry of d.npcmodelitemslotdisplayinfomap.get(creaturedisplayinfoextra?.ID) ?? []) {
					const displayInfo = d.itemdisplayinfo.getRow(entry.ItemDisplayInfoID);

					const ModelMaterialResourcesIDFileIDs = displayInfo.ModelMaterialResourcesID.map(
						id => id === 0 ? id : DBTextureFileData.getTextureFDIDsByMatID(id)[0]);

					const ModelResourcesIDFileIDs = displayInfo.ModelResourcesID.map(
						id => id === 0 ? id : DBModelFileData.getModelFileDataID(id)[0]);

					itemSlots[entry.ItemSlot] = {
						...entry,
						displayInfo: {
							...displayInfo,
							ModelMaterialResourcesIDFileIDs,
							ModelMaterialResourcesIDFiles: ModelMaterialResourcesIDFileIDs.map(id => id > 0 ? addToExport(listfile.getByID(id)) : 0),
							ModelResourcesIDFileIDs,
							ModelResourcesIDFiles: ModelResourcesIDFileIDs.map(id => listfile.getByID(id)),
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

			const helper = new ExportHelper(1 + extraExports.size, 'creature-data');
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

					<h3>Enabled Geosets</h3>
					<div>{{ enabledGeosets }}</div>
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
				<input type="button" value="Export" @click="exportSelected" :class="{ disabled: isBusy || selectedData == null }" />
			</div>
		</div>
	`
}