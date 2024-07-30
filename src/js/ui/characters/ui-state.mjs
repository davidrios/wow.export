const { ref } = Vue;

let shared = null;

export default function() {
	if (shared != null)
		return shared;

	const chrModelViewerContext = ref();

	const chrCustRaces = ref([]); // Available character races to select from
	const chrCustRaceSelection = ref([]); // Current race ID selected
	const chrCustModels = ref([]); // Available character customization models.
	const chrCustModelSelection = ref([]); // Selected character customization model.
	const chrCustOptions = ref([]); // Available character customization options.
	const chrCustOptionSelection = ref([]); // Selected character customization option.
	const chrCustChoices = ref([]); // Available character customization choices.
	const chrCustChoiceSelection = ref([]); // Selected character customization choice.
	const chrCustActiveChoices = ref(new Map()); // Active character customization choices.
	const chrCustGeosets = ref([]); // Character customization model geoset control.
	const chrCustTab = ref('models'); // Active tab for character customization.
	const chrCustRightTab = ref('geosets'); // Active right tab for character customization.
	const chrCustUnsupportedWarning = ref(false); // Display warning for unsupported character customizations.
	const chrImportChrName = ref(''); // Character import, character name input.

	const chrImportRegions = ref([]);
	const chrImportRealms = ref([]);
	const chrImportSelectedRegion = ref('');
	const chrImportSelectedRealm = ref(null);
	const chrImportLoadVisage = ref(false); // Whether or not to load the visage model instead (Dracthyr/Worgen)
	const chrImportChrModelID = ref(0); // Temporary storage for target character model ID.
	const chrImportChoices = ref([]); // Temporary storage for character import choices.

	shared = {
		chrModelViewerContext,
		chrCustRaces,
		chrCustRaceSelection,
		chrCustModels,
		chrCustModelSelection,
		chrCustOptions,
		chrCustOptionSelection,
		chrCustChoices,
		chrCustChoiceSelection,
		chrCustActiveChoices,
		chrCustGeosets,
		chrCustTab,
		chrCustRightTab,
		chrCustUnsupportedWarning,
		chrImportChrName,
		chrImportRegions,
		chrImportRealms,
		chrImportSelectedRegion,
		chrImportSelectedRealm,
		chrImportLoadVisage,
		chrImportChrModelID,
		chrImportChoices,
	};

	return shared;
}