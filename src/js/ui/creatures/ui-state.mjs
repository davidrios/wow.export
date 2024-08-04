const generics = require('/js/generics');

const { ref } = Vue;

let shared = null;

export default function() {
	if (shared != null)
		return shared;

	const creatures = ref([]);
	const creaturesFilter = generics.debouncedRef('');
	const creaturesSelection = ref([]);
	const selectedDisplayInfo = ref();
	const selectedSoundKit = ref();
	const selectedSoundKitKeys = ref();

	shared = {
		creatures,
		creaturesFilter,
		creaturesSelection,
		selectedDisplayInfo,
		selectedSoundKit,
		selectedSoundKitKeys,
	};

	return shared;
}