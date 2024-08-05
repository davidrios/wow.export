const generics = require('/js/generics');

const { ref } = Vue;

let shared = null;

export default function() {
	if (shared != null)
		return shared;

	const creaturesFilter = generics.debouncedRef('');
	const creaturesSelection = ref([]);
	const selectedDisplayInfo = ref();
	const selectedSoundKit = ref();
	const selectedSoundKitKeys = ref();

	shared = {
		creaturesFilter,
		creaturesSelection,
		selectedDisplayInfo,
		selectedSoundKit,
		selectedSoundKitKeys,
	};

	return shared;
}