const { ref } = Vue;

let shared = null;

export default function() {
	if (shared != null)
		return shared;

	const creatures = ref([]);
	const searchTerm = ref('');
	const searchPage = ref(1);
	const searchResults = ref(new Map());
	const creaturesSelection = ref([]);

	shared = {
		creatures,
		searchTerm,
		searchPage,
		searchResults,
		creaturesSelection
	};

	return shared;
}