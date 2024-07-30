const core = require('/js/core');
const WDCReader = require('/js/db/WDCReader');
const realmlist = require('/js/casc/realmlist');
const DBCreatures = require('/js/db/caches/DBCreatures');

let shared = null;

export default async function (view) {
	if (shared != null)
		return shared;

	const chrModelIDToFileDataID = new Map();
	const chrModelIDToTextureLayoutID = new Map();
	const optionsByChrModel = new Map();
	const optionToChoices = new Map();
	const defaultOptions = new Array();

	const chrRaceMap = new Map();
	const chrRaceXChrModelMap = new Map();

	const choiceToGeoset = new Map();
	const choiceToChrCustMaterialID = new Map();
	const choiceToSkinnedModel = new Map();
	const unsupportedChoices = new Array();

	const geosetMap = new Map();
	const chrCustMatMap = new Map();
	const chrModelTextureLayerMap = new Map();
	const charComponentTextureSectionMap = new Map();
	const chrModelMaterialMap = new Map();
	const chrCustSkinnedModelMap = new Map();

	// Initialize a loading screen.
	const progress = core.createProgress(14);
	view.setScreen('loading');
	view.isBusy++;

	await progress.step('Retrieving realmlist...');
	await realmlist.load();

	await progress.step('Loading texture mapping...');
	const tfdDB = new WDCReader('DBFilesClient/TextureFileData.db2');
	await tfdDB.parse();
	const tfdMap = new Map();
	for (const tfdRow of tfdDB.getAllRows().values()) {
		// Skip specular (1) and emissive (2)
		if (tfdRow.UsageType != 0)
			continue;
		tfdMap.set(tfdRow.MaterialResourcesID, tfdRow.FileDataID);
	}

	await progress.step('Loading character models..');
	const chrModelDB = new WDCReader('DBFilesClient/ChrModel.db2');
	await chrModelDB.parse();

	await progress.step('Loading character customization choices...');
	const chrCustChoiceDB = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2');
	await chrCustChoiceDB.parse();

	// TODO: There is so many DB2 loading below relying on fields existing, we should probably check for them first and handle missing ones gracefully.
	await progress.step('Loading character customization materials...');
	const chrCustMatDB = new WDCReader('DBFilesClient/ChrCustomizationMaterial.db2');
	await chrCustMatDB.parse();

	await progress.step('Loading character customization elements...');
	const chrCustElementDB = new WDCReader('DBFilesClient/ChrCustomizationElement.db2');
	await chrCustElementDB.parse();

	for (const chrCustomizationElementRow of chrCustElementDB.getAllRows().values()) {
		if (chrCustomizationElementRow.ChrCustomizationGeosetID != 0)
			choiceToGeoset.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationGeosetID);

		if (chrCustomizationElementRow.ChrCustomizationSkinnedModelID != 0) {
			choiceToSkinnedModel.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationSkinnedModelID);
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);
		}

		if (chrCustomizationElementRow.ChrCustomizationBoneSetID != 0)
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

		if (chrCustomizationElementRow.ChrCustomizationCondModelID != 0)
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

		if (chrCustomizationElementRow.ChrCustomizationDisplayInfoID != 0)
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

		if (chrCustomizationElementRow.ChrCustomizationMaterialID != 0) {
			if (choiceToChrCustMaterialID.has(chrCustomizationElementRow.ChrCustomizationChoiceID))
				choiceToChrCustMaterialID.get(chrCustomizationElementRow.ChrCustomizationChoiceID).push({ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID });
			else
				choiceToChrCustMaterialID.set(chrCustomizationElementRow.ChrCustomizationChoiceID, [{ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID }]);

			const matRow = chrCustMatDB.getRow(chrCustomizationElementRow.ChrCustomizationMaterialID);
			chrCustMatMap.set(matRow.ID, {ChrModelTextureTargetID: matRow.ChrModelTextureTargetID, FileDataID: tfdMap.get(matRow.MaterialResourcesID)});
		}
	}

	await progress.step('Loading character customization options...');
	const chrCustOptDB = new WDCReader('DBFilesClient/ChrCustomizationOption.db2');
	await chrCustOptDB.parse();

	for (const [chrModelID, chrModelRow] of chrModelDB.getAllRows()) {
		const fileDataID = DBCreatures.getFileDataIDByDisplayID(chrModelRow.DisplayID);

		chrModelIDToFileDataID.set(chrModelID, fileDataID);
		chrModelIDToTextureLayoutID.set(chrModelID, chrModelRow.CharComponentTextureLayoutID);

		for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of chrCustOptDB.getAllRows()) {
			if (chrCustomizationOptionRow.ChrModelID != chrModelID)
				continue;

			const choiceList = [];

			if (!optionsByChrModel.has(chrCustomizationOptionRow.ChrModelID))
				optionsByChrModel.set(chrCustomizationOptionRow.ChrModelID, []);

			let optionName = '';
			if (chrCustomizationOptionRow.Name_lang != '')
				optionName = chrCustomizationOptionRow.Name_lang;
			else
				optionName = 'Option ' + chrCustomizationOptionRow.OrderIndex;

			optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).push({ id: chrCustomizationOptionID, label: optionName });

			for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of chrCustChoiceDB.getAllRows()) {
				if (chrCustomizationChoiceRow.ChrCustomizationOptionID != chrCustomizationOptionID)
					continue;

				// Generate name because Blizz hasn't gotten around to setting it for everything yet.
				let name = '';
				if (chrCustomizationChoiceRow.Name_lang != '')
					name = chrCustomizationChoiceRow.Name_lang;
				else
					name = 'Choice ' + chrCustomizationChoiceRow.OrderIndex;

				if (unsupportedChoices.includes(chrCustomizationChoiceID))
					name += '*';

				choiceList.push({ id: chrCustomizationChoiceID, label: name });
			}

			optionToChoices.set(chrCustomizationOptionID, choiceList);

			// If option flags does not have 0x20 ("EXCLUDE_FROM_INITIAL_RANDOMIZATION") we can assume it's a default option.
			if (!(chrCustomizationOptionRow.Flags & 0x20))
				defaultOptions.push(chrCustomizationOptionID);
		}
	}

	await progress.step('Loading character races..');
	const chrRacesDB = new WDCReader('DBFilesClient/ChrRaces.db2');
	await chrRacesDB.parse();

	for (const [chrRaceID, chrRaceRow] of chrRacesDB.getAllRows()) {
		const flags = chrRaceRow.Flags;
		chrRaceMap.set(chrRaceID, { id: chrRaceID, name: chrRaceRow.Name_lang, isNPCRace: ((flags & 1) == 1 && chrRaceID != 23 && chrRaceID != 75) });
	}

	await progress.step('Loading character race models..');
	const chrRaceXChrModelDB = new WDCReader('DBFilesClient/ChrRaceXChrModel.db2');
	await chrRaceXChrModelDB.parse();

	for (const chrRaceXChrModelRow of chrRaceXChrModelDB.getAllRows().values()) {
		if (!chrRaceXChrModelMap.has(chrRaceXChrModelRow.ChrRacesID))
			chrRaceXChrModelMap.set(chrRaceXChrModelRow.ChrRacesID, new Map());

		chrRaceXChrModelMap.get(chrRaceXChrModelRow.ChrRacesID).set(chrRaceXChrModelRow.Sex, chrRaceXChrModelRow.ChrModelID);
	}

	await progress.step('Loading character model materials..');
	const chrModelMatDB = new WDCReader('DBFilesClient/ChrModelMaterial.db2');
	await chrModelMatDB.parse();

	for (const chrModelMaterialRow of chrModelMatDB.getAllRows().values())
		chrModelMaterialMap.set(chrModelMaterialRow.CharComponentTextureLayoutsID + "-" + chrModelMaterialRow.TextureType, chrModelMaterialRow);

	// load charComponentTextureSection
	await progress.step('Loading character component texture sections...');
	const charComponentTextureSectionDB = new WDCReader('DBFilesClient/CharComponentTextureSections.db2');
	await charComponentTextureSectionDB.parse();
	for (const charComponentTextureSectionRow of charComponentTextureSectionDB.getAllRows().values()) {
		if (!charComponentTextureSectionMap.has(charComponentTextureSectionRow.CharComponentTextureLayoutID))
			charComponentTextureSectionMap.set(charComponentTextureSectionRow.CharComponentTextureLayoutID, []);

		charComponentTextureSectionMap.get(charComponentTextureSectionRow.CharComponentTextureLayoutID).push(charComponentTextureSectionRow);
	}

	await progress.step('Loading character model texture layers...');
	const chrModelTextureLayerDB = new WDCReader('DBFilesClient/ChrModelTextureLayer.db2');
	await chrModelTextureLayerDB.parse();
	for (const chrModelTextureLayerRow of chrModelTextureLayerDB.getAllRows().values())
		chrModelTextureLayerMap.set(chrModelTextureLayerRow.CharComponentTextureLayoutsID + "-" + chrModelTextureLayerRow.ChrModelTextureTargetID[0], chrModelTextureLayerRow);

	await progress.step('Loading character customization geosets...');
	const chrCustGeosetDB = new WDCReader('DBFilesClient/ChrCustomizationGeoset.db2');
	await chrCustGeosetDB.parse();

	for (const [chrCustomizationGeosetID, chrCustomizationGeosetRow] of chrCustGeosetDB.getAllRows()) {
		const geoset = chrCustomizationGeosetRow.GeosetType.toString().padStart(2, '0') + chrCustomizationGeosetRow.GeosetID.toString().padStart(2, '0');
		geosetMap.set(chrCustomizationGeosetID, Number(geoset));
	}

	await progress.step('Loading character customization skinned models...');

	const chrCustSkinnedModelDB = new WDCReader('DBFilesClient/ChrCustomizationSkinnedModel.db2');
	await chrCustSkinnedModelDB.parse();
	for (const [chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow] of chrCustSkinnedModelDB.getAllRows())
		chrCustSkinnedModelMap.set(chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow);

	// Show the characters screen.
	view.loadPct = -1;
	view.isBusy--;
	view.setScreen('tab-characters');

	shared = {
		chrModelIDToFileDataID,
		chrModelIDToTextureLayoutID,
		optionsByChrModel,
		optionToChoices,
		defaultOptions,
		chrRaceMap,
		chrRaceXChrModelMap,
		choiceToGeoset,
		choiceToChrCustMaterialID,
		choiceToSkinnedModel,
		unsupportedChoices,
		geosetMap,
		chrCustMatMap,
		chrModelTextureLayerMap,
		charComponentTextureSectionMap,
		chrModelMaterialMap,
		chrCustSkinnedModelMap
	}

	return shared;
}