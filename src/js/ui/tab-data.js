/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const log = require('src/js/log');
const generics = require('src/js/generics');
const listfile = require('src/js/casc/listfile');
const WDCReader = require('src/js/db/WDCReader');
const path = require('path');

const { inject, ref } = Vue;

export default {
	setup() {
		const view = inject('view');

		const fileSelection = ref([]);
		const fileFilter = generics.debouncedRef('');
		const tableHeaders = ref([]);
		const tableRows = ref([]);
		const tableFilter = generics.debouncedRef('');

		let lastLoaded = null;
		let db2NameMap = null;
		// Keep track of loading order so an earlier load doesn't affect the UI
		let currentLoadIteration = 0;

		async function loadSelected(selected) {
			if (view.isBusy)
				return;

			if (selected == null) {
				tableHeaders.value = [];
				tableRows.value = [];
				tableFilter.value = '';
				lastLoaded = null;
				return;
			}

			const first = listfile.stripFileEntry(selected);
			if (!first || lastLoaded === first)
				return;

			tableHeaders.value = [];
			tableRows.value = [];
			tableFilter.value = '';

			lastLoaded = first;
			const myLoadIteration = ++currentLoadIteration;

			view.setToast('progress', `Loading ${first}, please wait...`, null, -1, false);

			try {
				if (db2NameMap == null) {
					db2NameMap = Object.fromEntries(
						(await generics.getJSON("https://api.wow.tools/databases/"))
							.map(({name, displayName}) => [name, displayName])
					);
				}
				if (myLoadIteration !== currentLoadIteration)
					return;

				const lowercaseTableName = path.basename(first, '.db2');
				const tableName = db2NameMap[lowercaseTableName];
				if (tableName == null)
					throw new Error(`Display name not found for ${lowercaseTableName}`);

				const db2Reader = new WDCReader(`DBFilesClient/${tableName}.db2`);
				await db2Reader.parse();
				if (myLoadIteration !== currentLoadIteration)
					return;

				const rows = db2Reader.getAllRows();

				if (rows.size == 0)
					view.setToast('info', 'Selected DB2 has no rows.', null);
				else
					view.hideToast(false);

				const parsed = new Array(rows.size);

				let index = 0;
				for (const row of rows.values())
					parsed[index++] = Object.values(row);

				tableHeaders.value = [...db2Reader.schema.keys()];
				tableRows.value = parsed;
			} catch (e) {
				// Error reading/parsing DB2 file.
				if (myLoadIteration === currentLoadIteration)
					view.setToast('error', 'Unable to open DB2 file ' + selected, { 'View Log': () => log.openRuntimeLog() }, -1);

				log.write('Failed to open CASC file: %s', e.message);
			}
		}

		return {
			view,
			config: view.config,
			selection: fileSelection,
			fileFilter,
			tableHeaders,
			tableRows,
			tableFilter,
			loadSelected
		}
	},
	template: `
		<div class="tab list-tab" id="tab-data">
			<div class="list-container">
				<listbox v-model:selection="selection" :items="view.listfileDB2s" :filter="fileFilter" :keyinput="true"
					:regex="config.regexFilters" :copydir="config.copyFileDirectories" :pasteselection="config.pasteSelection"
					:copytrimwhitespace="config.removePathSpacesCopy" :includefilecount="false" unittype="db2 file" :single="true"
					@update:selection="loadSelected($event[0])"
				></listbox>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="config.regexFilters" :title="regexTooltip">Regex Enabled</div>
				<input type="text" v-model="fileFilter" placeholder="Filter DB2s..." />
			</div>
			<div class="list-container">
				<data-table :headers="tableHeaders" :rows="tableRows" :filter="tableFilter" :regex="config.regexFilters"></data-table>
			</div>
			<div class="filter filter2">
				<div class="regex-info" v-if="config.regexFilters" :title="regexTooltip">Regex Enabled</div>
				<input type="text" v-model="tableFilter" placeholder="Filter rows..." />
			</div>
		</div>
	`
}
