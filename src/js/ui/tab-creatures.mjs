const core = require('/js/core');
const constants = require('/js/constants');

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
			searchTerm,
			searchPage,
			searchResults,
			selectedSoundKit,
		} = uiState;

		let d;
		// setup can't be async, so this needs to be scheduled like this
		(async function () {
			d = await loadData(view);
			window._aaa = d;
			isLoaded.value = d != null;
		})();

		function getLocale() {
			return view.selectedLocaleKey.substring(0, 2) + '_' + view.selectedLocaleKey.substring(2);
		}

		async function getCreatureByID(creatureId) {
			const casc = view.casc;
			const namespace = `${constants.WOWAPI_NAMESPACE[casc.build.Product]}-${casc.build.Branch}`;
			const params = new URLSearchParams({
				namespace,
				locale: getLocale()
			});

			const token = await core.getWowAPIToken();
			const res = await fetch(
				`https://${casc.build.Branch}.api.blizzard.com/data/wow/creature/${creatureId}?` + params.toString(),
				{
					method: 'GET',
					headers: { 'Authorization': `Bearer ${token}` },
				}
			);

			if (!res.ok)
				throw new Error('Response error.');

			if (res.status !== 200)
				throw new Error(`Response error: ${res.status} ${res.statusText}.`);

			return await res.json();
		}

		async function searchCreature(name, page=1) {
			if (name.startsWith('id:')) {
				return {
					results: [{ data: await getCreatureByID(name.substring(3)) }]
				};
			}

			const casc = view.casc;
			const namespace = `${constants.WOWAPI_NAMESPACE[casc.build.Product]}-${casc.build.Branch}`;
			const locale = getLocale();
			const locName = `name.${locale}`;
			const params = new URLSearchParams({
				namespace,
				[locName]: name,
				orderby: locName,
				_page: page,
			});

			const token = await core.getWowAPIToken();
			const res = await fetch(
				`https://${casc.build.Branch}.api.blizzard.com/data/wow/search/creature?` + params.toString(),
				{
					method: 'GET',
					headers: { 'Authorization': `Bearer ${token}` },
				}
			);

			if (!res.ok)
				throw new Error('Response error.');

			if (res.status !== 200)
				throw new Error(`Response error: ${res.status} ${res.statusText}.`);

			const results = await res.json();
			for (const item of results.results) {
				item.data.name = item.data.name[locale];
				item.data.family.name = item.data.family.name[locale];
				item.data.type.name = item.data.type.name[locale];
			}

			return results;
		}

		async function search() {
			isBusy.value = true;
			view.setToast('progress', 'Searching, please wait..', null, -1, false);

			try {
				const results = await searchCreature(searchTerm.value, searchPage.value);
				searchResults.value.clear();
				creatures.value = [];
				for (const {data} of results.results) {
					const name = new String(`${data.name} (${data.id})`);
					name.id = data.id;
					creatures.value.push(name);
					searchResults.value.set(data.id, data);
				}
				console.log(results);
				view.hideToast();
			} catch (e) {
				view.setToast('error', 'Error while searching.');
				console.error(e);
			} finally {
				isBusy.value = false;
			}
		}

		function loadSelected(creatureId) {
			if (creatureId == null)
				return;

			console.log('load', creatureId, searchResults.value.get(creatureId));
			selectedSoundKit.value = null;
		}

		const selectedData = computed(() => {
			const selected = creaturesSelection.value[0];
			if (selected == null)
				return;

			const info = searchResults.value.get(selected.id);
			if (info == null)
				return {};

			const creaturedisplayinfo = d.creaturedisplayinfo.getRow(info.creature_displays[0]?.id);
			const modeldata = d.creaturemodeldata.getRow(creaturedisplayinfo.ModelID);
			const sounddata = d.creaturesounddata.getRow(modeldata.SoundID);
			return {
				info,
				creaturedisplayinfo,
				modeldata,
				sounddata,
			}
		})

		provide('showSoundKit', function showSoundKit(id) {
			selectedSoundKit.value = id;
		});

		const soundKitEntries = computed(() => d.soundkitentrymap.get(selectedSoundKit.value))

		return {
			config: view.config,
			isLoaded,
			isBusy,
			selectedData,
			soundKitEntries,
			...uiState,
			search,
			loadSelected
		};
	},
	template: `
		<div class="tab list-tab" id="tab-creatures" v-if="isLoaded">
			<div class="list-container">
				<listbox
					v-model:selection="creaturesSelection" :items="creatures" unittype="creature" :single="true"
					@update:selection="loadSelected($event[0]?.id)"
				></listbox>
			</div>
			<div class="filter">
				<input type="text" v-model="searchTerm" placeholder="Search for creatures..." />
				<input type="button" value="Search" @click="searchPage = 1; search()" :class="{ disabled: isBusy }"/>
			</div>
			<div class="preview-container" v-if="selectedData != null">
				<div>
					<h3>Info</h3>
					<table-display type='info' :data="selectedData.info"></table-display>
				</div>
				<div>
					<h3>DisplayInfo</h3>
					<table-display type='displayinfo' :data="selectedData.creaturedisplayinfo"></table-display>
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