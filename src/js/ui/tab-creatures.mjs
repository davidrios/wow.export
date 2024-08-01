const core = require('/js/core');
const constants = require('/js/constants');

import loadData from './creatures/game-data.mjs';
import loadUiState from './creatures/ui-state.mjs';

const { ref, inject } = Vue;

function getLocale(view) {
	return view.selectedLocaleKey.substring(0, 2) + '_' + view.selectedLocaleKey.substring(2);
}

async function getCreatureByID(view, creatureId) {
	const casc = view.casc;
	const namespace = `${constants.WOWAPI_NAMESPACE[casc.build.Product]}-${casc.build.Branch}`;
	const params = new URLSearchParams({
		namespace,
		locale: getLocale(view)
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

async function searchCreature(view, name, page=1) {
	if (name.startsWith('id:')) {
		return {
			results: [{ data: await getCreatureByID(view, name.substring(3)) }]
		};
	}

	const casc = view.casc;
	const namespace = `${constants.WOWAPI_NAMESPACE[casc.build.Product]}-${casc.build.Branch}`;
	const locale = getLocale(view);
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
	for (const item of results.results)
		item.data.name = item.data.name[locale];

	return results;
}

export default {
	setup() {
		const view = inject('view');

		const isLoaded = ref(false);
		const isBusy = ref(false);
		const uiState = loadUiState();

		const {
			creatures,
			searchTerm,
			searchPage,
			searchResults,
		} = uiState;

		let d;
		// setup can't be async, so this needs to be scheduled like this
		(async function () {
			d = await loadData(view);
			window._aaa = d;
			isLoaded.value = d != null;
		})();

		async function search() {
			isBusy.value = true;
			view.setToast('progress', 'Searching, please wait..', null, -1, false);

			try {
				const results = await searchCreature(view, searchTerm.value, searchPage.value);
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
		}

		return {
			config: view.config,
			isLoaded,
			isBusy,
			...uiState,
			search,
			loadSelected,
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
			<div class="list-container">
				{{ creaturesSelection[0] ?? '' }}
			</div>
		</div>
	`
}