const path = require('path');

const listfile = require('/js/casc/listfile');

const { computed, inject } = Vue;

function modelidAction(component, _, value) {
	if (value > 0)
		component.selectDisplayInfo(value);
}
const FORMATTERS = {
	info: {
		modelid1(value) {
			return { component: 'action-link', value, action: modelidAction }
		},
		modelid2(value) {
			return { component: 'action-link', value, action: modelidAction }
		},
		modelid3(value) {
			return { component: 'action-link', value, action: modelidAction }
		},
		modelid4(value) {
			return { component: 'action-link', value, action: modelidAction }
		}
	},
	displayinfo: {
		TextureVariationFileDataID(value) {
			return { component: 'texture-list', value}
		}
	},
	modeldata: {
		FileDataID(value) {
			return { component: 'model-view', value }
		}
	},
	sounddata: {
		SoundID: function (value) {
			return { component: 'sound-kit-view', value }
		},
		SoundFidget(value) {
			return { component: 'sound-kit-list', value }
		},
		CustomAttack(value) {
			return { component: 'sound-kit-list', value }
		}
	},
	soundkitentry: {
		FileDataID(value) {
			return { component: 'sound-link', value }
		}
	}
}

function defaultFormatter(value) {
	if (typeof value === 'boolean')
		return { component: 'basic-text', value: value.toString().toUpperCase() };
	else if (typeof value === 'object')
		return { component: 'basic-text', value: JSON.stringify(value, null, 2) };

	return { component: 'basic-text', value };
}

function getFormatter(table, col) {
	const tableFs = FORMATTERS[table];

	if (table === 'sounddata' && col.endsWith('ID'))
		return tableFs.SoundID;

	return tableFs != null ? tableFs[col] ?? defaultFormatter : defaultFormatter;
}

const ActionLink = {
	props: ['value', 'title', 'action'],
	setup() {
		return {
			selectDisplayInfo: inject('selectDisplayInfo')
		}
	},
	template: `<a href="#" @click="action(this, $event, value)" :title="title">{{ value }}</a>`
}

const SoundLink = {
	props: ['value'],
	setup(props) {
		const view = inject('view');

		return {
			item: computed(() => {
				const file = listfile.getByID(props.value);
				return {
					id: props.value,
					file: file,
					name: path.basename(file),
				}
			}),
			goToSound(e, file) {
				e.preventDefault();
				view.goToSound(file);
			}
		}
	},
	template: `<a href="#" @click="goToSound($event, item.file)" :title="item.file">{{ item.name }}</a>`
}

const SoundKitView = {
	props: ['value'],
	setup() {
		return {
			showSoundKit: inject('showSoundKit')
		}
	},
	template: `<a href="#" @click="showSoundKit(value)">{{ value }}</a>`
}

const SoundKitList = {
	components: {
		SoundKitView
	},
	props: ['value'],
	setup(props) {
		return {
			items: computed(() => props.value.filter(item => item !== 0) )
		}
	},
	template: `
		<div>
			<ul v-if="items.length > 0">
				<li v-for="item in items"><sound-kit-view :value="item"></sound-kit-view></li>
			</ul>
			<p v-else>No items.</p>
		</div>
	`
}

const ModelView = {
	props: ['value'],
	setup(props) {
		const view = inject('view');

		return {
			item: computed(() => {
				const file = listfile.getByID(props.value);
				return {
					id: props.value,
					file: file,
					name: path.basename(file),
				}
			}),
			goToModel(e, file) {
				e.preventDefault();
				view.goToModel(file);
			}
		}
	},
	template: `<a href="#" @click="goToModel($event, item.file)" :title="item.file">{{ item.name }}</a>`
}

const TextureList = {
	props: ['value'],
	setup(props) {
		const view = inject('view');

		return {
			items: computed(() => props.value
				.filter(item => item > 0)
				.map(item => {
					const file = listfile.getByID(item);
					return {
						id: item,
						file: file,
						name: path.basename(file),
					}
				})
			),
			goToTexture(e, id) {
				e.preventDefault();
				view.goToTexture(id);
			}
		}
	},
	template: `
		<ul>
			<li v-for="item in items">
				<a href="#" @click="goToTexture($event, item.id)" :title="item.file">{{ item.name }}</a>
			</li>
		</ul>
	`
}

const BasicText = {
	props: ['value'],
	setup(props) {
		const view = inject('view');

		return {
			copy() {
				view.copyToClipboard(props.value);
				view.setToast('info', 'Value copied to clipboard.', null, 2000);
			}
		}
	},
	template: `<pre class="copy" @click="copy">{{ value }}</pre>`
}

export const TableDisplay = {
	components: {
		BasicText,
		TextureList,
		ModelView,
		SoundKitView,
		SoundKitList,
		SoundLink,
		ActionLink,
	},
	props: ['type', 'data'],
	setup(props) {
		return {
			data: computed(() => {
				const res = {};

				for (const key in props.data)
					res[key] = getFormatter(props.type, key)(props.data[key]);

				return res;
			}),
			isItemShown(type, key, val) {
				if (type !== 'sounddata')
					return true;

				if (!key.endsWith('ID'))
					return true;

				return val.value !== 0;
			}
		};
	},
	template: `
		<ul class="table-display">
			<template v-for="(val, key) in data">
				<li v-if="isItemShown(type, key, val)">
					<span class="label">{{key}}:</span>
					<component :is="val.component" v-bind="val"></component>
				</li>
			</template>
		</ul>
	`
}