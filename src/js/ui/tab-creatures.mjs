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
			window._aaa = d;
			isLoaded.value = d != null;
		})();

		function loadSelected(creatureId) {
			if (creatureId == null)
				return;

			const info = d.creaturetemplate.get(selectedCreatureId.value);
			if (info != null)
				selectedDisplayInfo.value = info.modelid1;

			selectedSoundKit.value = null;
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
				return {};

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

		const soundKitEntries = computed(() => d.soundkitentrymap.get(selectedSoundKit.value))

		return {
			config: view.config,
			isLoaded,
			isBusy,
			selectedData,
			soundKitEntries,
			...uiState,
			loadSelected
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
					<h3>SoundKitEntries</h3>
					<template v-if="soundKitEntries != null">
						<ul class="sound-kit-entries" v-if="soundKitEntries.length > 0">
							<li v-for="entry in soundKitEntries">
								<table-display type='soundkitentry' :data="entry"></table-display>
							</li>
						</ul>
						<p v-else>No entries.</p>
					</template>
					<p v-else>Click on a sound ID...</p>
				</div>
			</div>
		</div>
	`
}