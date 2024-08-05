const path = require('path');

const listfile = require('/js/casc/listfile');
const BLPFile = require('../casc/blp');
const ExportHelper = require('/js/casc/export-helper');
const JSONWriter = require('/js/3D/writers/JSONWriter');

import loadData from './creatures/game-data.mjs';
import loadUiState from './creatures/ui-state.mjs';
import { TableDisplay } from './creatures/components.mjs';

const { ref, computed, inject, provide } = Vue;

export default {
	components: { TableDisplay },
	setup() {
		const view = inject('view');

		const isLoaded = ref(false);
		const isBusy = ref(false);
		const uiState = loadUiState();

		const {
			creatures,
			creaturesSelection,
			selectedDisplayInfo,
			selectedSoundKit,
			selectedSoundKitKeys,
		} = uiState;

		let d;
		// setup can't be async, so this needs to be scheduled like this
		(async function () {
			d = await loadData(view);

			creatures.value = Array.from(d.creaturetemplate.values()).map(entry => {
				const name = new String(`${entry.name} (${entry.id})`);
				name.id = entry.id;
				return name;
			})

			if (creaturesSelection.value.length > 0)
				creaturesSelection.value = creatures.value.filter(entry => entry.id === creaturesSelection.value[0].id);

			if (selectedSoundKitKeys.value == null) {
				selectedSoundKitKeys.value = Object.fromEntries(
					Array.from(d.creaturesounddata.schema.keys())
						.filter(key => (key.endsWith('ID') && key !== 'ID') || key === 'SoundFidget' || key === 'CustomAttack')
						.map(key => [key, true])
				);
			}

			window._aaa = d;
			isLoaded.value = d != null;
		})();

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

		provide('selectedSoundKitKeys', selectedSoundKitKeys);

		provide('selectDisplayInfo', function selectDisplayInfo(id) {
			selectedDisplayInfo.value = id;
		});

		const soundKit = computed(() => d.soundkit.getRow(selectedSoundKit.value));
		const soundKitEntries = computed(() => d.soundkitentrymap.get(selectedSoundKit.value));

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

				displayInfo[displayInfoId] = {
					...creaturedisplayinfo,
					TextureVariationFileData: creaturedisplayinfo.TextureVariationFileDataID
						.filter(id => id !== 0)
						.map(id => addToExport(listfile.getByID(id))),
					extra: creaturedisplayinfoextra ?? {},
					model: {
						...modeldata,
						FileData: listfile.getByID(modeldata.FileDataID),
						sound: modelsounddata ?? {}
					},
				};

				for (const name in selectedSoundKitKeys.value) {
					if (!selectedSoundKitKeys.value[name] || modelsounddata == null || modelsounddata[name] == null)
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
			selectedData,
			soundKit,
			soundKitEntries,
			...uiState,
			loadSelected,
			exportSelected
		};
	},
	template: `
		<div class="tab list-tab" id="tab-creatures" v-if="isLoaded">
			<div class="list-container">
				<listbox
					v-model:selection="creaturesSelection" :items="creatures" :filter="creaturesFilter" unittype="creature"
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
				</div>
				<div>
					<h3>ModelData</h3>
					<table-display type='modeldata' :data="selectedData.modeldata"></table-display>
				</div>
				<div>
					<h3>SoundData</h3>
					<table-display type='sounddata' :data="selectedData.sounddata"></table-display>
				</div>
				<div>
					<template v-if="soundKitEntries != null">
						<h3>SoundKitEntries</h3>
						<ul class="sound-kit-entries" v-if="soundKitEntries.length > 0">
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