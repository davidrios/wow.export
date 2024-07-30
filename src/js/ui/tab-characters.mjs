/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const util = require('util');
const core = require('/js/core');
const log = require('/js/log');
const generics = require('/js/generics');
const CharMaterialRenderer = require('/js/3D/renderers/CharMaterialRenderer');
const M2Renderer = require('/js/3D/renderers/M2Renderer');
const M2Exporter = require('/js/3D/exporters/M2Exporter');
const ExportHelper = require('/js/casc/export-helper');
const listfile = require('/js/casc/listfile');

// They're in different modules so they only need to reload if the module changes
import loadData from './characters/game-data.mjs';
import loadRendering from './characters/rendering.mjs';
import TextureOverlay from './characters/texture-overlay.mjs';

const { inject, ref, watch, onBeforeUnmount } = Vue;

export default {
	components: {
		TextureOverlay
	},
	setup() {
		const view = inject('view');

		const isLoaded = ref(false);
		const chrModelViewerContext = ref();
		const chrImportRegions = ref([]);
		const chrImportRealms = ref([]);

		const chrImportSelectedRegion = ref('');
		watch(chrImportSelectedRegion, () => {
			const realmList = view.realmList[chrImportSelectedRegion.value].map(realm => ({ label: realm.name, value: realm.slug }));
			chrImportRealms.value = realmList;

			if (chrImportSelectedRealm.value !== null && !realmList.find(realm => realm.value === chrImportSelectedRealm.value))
				chrImportSelectedRealm.value = null;
		});

		let r;
		let d;
		// setup can't be async, so this needs to be scheduled like this
		(async function () {
			d = await loadData(view);
			r = await loadRendering(view);
			chrModelViewerContext.value = r.modelViewerContext;
			chrImportRegions.value = Object.keys(view.realmList);
			chrImportSelectedRegion.value = chrImportRegions.value[0];

			updateChrRaceList();

			isLoaded.value = true;
		})();

		const activeSkins = new Map();

		let activeRenderer;
		let activeModel;
		onBeforeUnmount(() => {
			activeRenderer?.dispose();
			disposeSkinnedModels();
		});

		const skinnedModelRenderers = new Map();
		const skinnedModelMeshes = new Set();

		const chrMaterials = ref(new Map());

		//let textureShaderMap = new Map();
		let currentCharComponentTextureLayoutID = 0;

		async function resetMaterials() {
			for (const chrMaterial of chrMaterials.value.values()) {
				await chrMaterial.reset();
				await chrMaterial.update();
			}
		}

		function disposeSkinnedModels() {
			for (const [fileDataID, skinnedModelRenderer] of skinnedModelRenderers) {
				console.log('Disposing of unused skinned model ' + fileDataID);
				skinnedModelRenderer.dispose();
			}

			skinnedModelRenderers.clear();

			for (const mesh of skinnedModelMeshes)
				r.renderGroup.remove(mesh);

			skinnedModelMeshes.clear();
		}

		async function uploadRenderOverrideTextures() {
			for (const [chrModelTextureTarget, chrMaterial] of chrMaterials.value) {
				await chrMaterial.update();
				await activeRenderer.overrideTextureTypeWithCanvas(chrModelTextureTarget,  chrMaterial.getCanvas());
			}
		}

		const chrCustRaces = ref([]); // Available character races to select from
		const chrCustRaceSelection = ref([]); // Current race ID selected
		const chrCustModels = ref([]); // Available character customization models.
		const chrCustModelSelection = ref([]); // Selected character customization model.
		const chrCustOptions = ref([]); // Available character customization options.
		const chrCustOptionSelection = ref([]); // Selected character customization option.
		const chrCustChoices = ref([]); // Available character customization choices.
		const chrCustChoiceSelection = ref([]); // Selected character customization choice.
		const chrCustActiveChoices = ref([]); // Active character customization choices.
		const chrCustGeosets = ref([]); // Character customization model geoset control.
		const chrCustTab = ref('models'); // Active tab for character customization.
		const chrCustRightTab = ref('geosets'); // Active right tab for character customization.
		const chrCustUnsupportedWarning = ref(false); // Display warning for unsupported character customizations.
		const chrImportChrName = ref(''); // Character import, character name input.

		const chrImportSelectedRealm = ref(null);
		const chrImportLoadVisage = ref(false); // Whether or not to load the visage model instead (Dracthyr/Worgen)
		const chrImportChrModelID = ref(0); // Temporary storage for target character model ID.
		const chrImportChoices = ref([]); // Temporary storage for character import choices.

		async function updateActiveCustomization() {
			await resetMaterials();

			const newSkinnedModels = new Map();

			const selection = chrCustActiveChoices.value;
			for (const activeChoice of selection) {
				// Update all geosets for this option.
				const availableChoices = d.optionToChoices.get(activeChoice.optionID);

				for (const availableChoice of availableChoices) {
					const chrCustGeoID = d.choiceToGeoset.get(availableChoice.id);
					const geoset = d.geosetMap.get(chrCustGeoID);

					if (geoset !== undefined) {
						for (const availableGeoset of chrCustGeosets.value) {
							// HACK: Never touch geoset 0 (base skin)
							if (availableGeoset.id == 0)
								continue;

							if (availableGeoset.id === geoset) {
								let shouldBeChecked = availableChoice.id == activeChoice.choiceID;
								if (availableGeoset.checked != shouldBeChecked)
									availableGeoset.checked = shouldBeChecked;
							}
						}
					}
				}

				// Update material (if applicable)
				const chrCustMatIDs = d.choiceToChrCustMaterialID.get(activeChoice.choiceID);

				if (chrCustMatIDs != undefined) {
					for (const chrCustMatID of chrCustMatIDs) {
						if (chrCustMatID.RelatedChrCustomizationChoiceID != 0) {
							const hasRelatedChoice = selection.find((selectedChoice) => selectedChoice.choiceID === chrCustMatID.RelatedChrCustomizationChoiceID);
							if (!hasRelatedChoice)
								continue;
						}

						const chrCustMat = d.chrCustMatMap.get(chrCustMatID.ChrCustomizationMaterialID);
						const chrModelTextureTarget = chrCustMat.ChrModelTextureTargetID;

						// Find row in ChrModelTextureLayer that matches ChrModelTextureTargetID and current CharComponentTextureLayoutID
						const chrModelTextureLayer = d.chrModelTextureLayerMap.get(currentCharComponentTextureLayoutID + "-" + chrModelTextureTarget);
						if (chrModelTextureLayer === undefined) {
							console.log("Unable to find ChrModelTextureLayer for ChrModelTextureTargetID " + chrModelTextureTarget + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)
							// TODO: Investigate but continue for now, this breaks e.g. dwarven beards
							continue;
						}

						// Find row in ChrModelMaterial based on chrModelTextureLayer.TextureType and current CharComponentTextureLayoutID
						const chrModelMaterial = d.chrModelMaterialMap.get(currentCharComponentTextureLayoutID + "-" + chrModelTextureLayer.TextureType);
						if (chrModelMaterial === undefined)
							console.log("Unable to find ChrModelMaterial for TextureType " + chrModelTextureLayer.TextureType + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)

						let chrMaterial;

						if (!chrMaterials.value.has(chrModelMaterial.TextureType)) {
							chrMaterial = new CharMaterialRenderer(chrModelMaterial.TextureType, chrModelMaterial.Width, chrModelMaterial.Height);
							chrMaterials.value.set(chrModelMaterial.TextureType, chrMaterial);

							await chrMaterial.init();
						} else {
							chrMaterial = chrMaterials.value.get(chrModelMaterial.TextureType);
						}

						// Find row in CharComponentTextureSection based on chrModelTextureLayer.TextureSectionTypeBitMask and current CharComponentTextureLayoutID
						let charComponentTextureSection;

						if (chrModelTextureLayer.TextureSectionTypeBitMask == -1) {
							charComponentTextureSection = { X: 0, Y: 0, Width: chrModelMaterial.Width, Height: chrModelMaterial.Height };
						} else {
							const charComponentTextureSectionResults = d.charComponentTextureSectionMap.get(currentCharComponentTextureLayoutID);
							for (const charComponentTextureSectionRow of charComponentTextureSectionResults) {
								// Check TextureSectionTypeBitMask to see if it contains SectionType (1-14)
								if ((1 << charComponentTextureSectionRow.SectionType) & chrModelTextureLayer.TextureSectionTypeBitMask) {
									charComponentTextureSection = charComponentTextureSectionRow;
									break;
								}
							}
						}

						if (charComponentTextureSection === undefined)
							console.log("Unable to find CharComponentTextureSection for TextureSectionTypeBitMask " + chrModelTextureLayer.TextureSectionTypeBitMask + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)

						let useAlpha = true;
						// if (textureShaderMap.has(chrModelTextureLayer.TextureType)) {
						// 	const shadersForTexture = textureShaderMap.get(chrModelTextureLayer.TextureType);
						// 	const pixelShader = shadersForTexture.PS;
						// 	console.log("Texture type " + chrModelTextureLayer.TextureType + " " + listfile.getByID(chrCustMat.FileDataID) +" has pixel shader " + pixelShader);

						// 	// Yeah no this doesn't work and is NOT how all this is supposed to work
						// 	if (pixelShader.startsWith('Combiners_Opaque') && chrModelTextureLayer.TextureSectionTypeBitMask == -1)
						// 		useAlpha = false;
						// }

						await chrMaterial.setTextureTarget(chrCustMat, charComponentTextureSection, chrModelMaterial, chrModelTextureLayer, useAlpha);
					}
				}

				// Update skinned model (DH wings, Dracthyr armor, Mechagnome armor, etc) (if applicable)
				// const chrCustSkinnedModelID = choiceToSkinnedModel.get(activeChoice.choiceID);
				// if (chrCustSkinnedModelID != undefined) {
				// 	const skinnedModelRow = chrCustSkinnedModelMap.get(chrCustSkinnedModelID);
				// 	if (skinnedModelRow !== undefined)
				// 		newSkinnedModels.set(skinnedModelRow.CollectionsFileDataID, skinnedModelRow);
				// }
			}

			disposeSkinnedModels();

			for (const [fileDataID, skinnedModelRow] of newSkinnedModels) {
				console.log('Loading skinned model ' + fileDataID);

				// Load model
				const skinnedModelRenderer = new M2Renderer(await view.casc.getFile(fileDataID), r.renderGroup, false);
				await skinnedModelRenderer.load();

				// Set geosets
				const geosetToEnable = skinnedModelRow.GeosetType * 100 + skinnedModelRow.GeosetID;

				for (let i = 0; i < skinnedModelRenderer.geosetArray.length; i++) {
					const geoset = skinnedModelRenderer.geosetArray[i];
					const geosetID = geoset.id;

					if (geosetID === geosetToEnable) {
						geoset.enabled = true;
						console.log('Enabling geoset ' + geosetID);
					} else {
						geoset.enabled = false;
					}
				}

				// Manually call this because we don't load these as reactive.
				skinnedModelRenderer.updateGeosets();
				skinnedModelRenderers.set(fileDataID, skinnedModelRenderer);

				const mesh = skinnedModelRenderers.get(fileDataID).meshGroup.clone(true);
				r.renderGroup.add(mesh);

				skinnedModelMeshes.add(mesh);
			}

			await uploadRenderOverrideTextures();
		}

		async function updateChrRaceList() {
			// Keep a list of listed models.
			// Some races are duplicated because of multi-factions,
			// so we will store races based on unique model IDs.
			const listedModelIDs = [];
			const listedRaceIDs = [];

			// Empty the arrays.
			chrCustRaces.value = [];

			// Build character model list.
			for (const [chrRaceID, chrRaceInfo] of d.chrRaceMap) {
				if (!d.chrRaceXChrModelMap.has(chrRaceID))
					continue;

				const chrModels = d.chrRaceXChrModelMap.get(chrRaceID);
				for (const chrModelID of chrModels.values()) {
					// If we're filtering NPC races, bail out.
					if (!view.config.chrCustShowNPCRaces && chrRaceInfo.isNPCRace)
						continue;

					// If we've seen this character model before, we don't need to record it again.
					if (listedModelIDs.includes(chrModelID))
						continue;

					listedModelIDs.push(chrModelID);

					// Need to do a check here to ensure we didn't already add this race
					// in the case of them having more than one model type
					if (listedRaceIDs.includes(chrRaceID))
						continue;

					listedRaceIDs.push(chrRaceID);

					// By the time we get here, we know we have a genuinly new race to add to the list!
					// Let's polish it up.

					// Build the label for the race data
					let raceLabel = chrRaceInfo.name;

					// To easily distinguish some weird names, we'll label NPC races.
					// ie: thin humans are just called "human" and aren't given a unique body type.
					// In the future, we could show the ClientFileString column if the label is already taken.
					if (chrRaceInfo.isNPCRace)
						raceLabel = raceLabel + ' [NPC]';

					// It's ready to go:
					const newRace = {id: chrRaceInfo.id, label: raceLabel }
					chrCustRaces.value.push(newRace);

					// Do a quick check on our selection, if it exists.
					// Since we just instantiated a new object, we need to ensure the selection is updated.
					if (chrCustRaceSelection.value.length > 0 && newRace.id == chrCustRaceSelection.value[0].id)
						chrCustRaceSelection.value = [newRace];
				}
			}

			// Sort alphabetically
			chrCustRaces.value.sort((a, b) => {
				return a.label.localeCompare(b.label);
			});

			// If we haven't selected a race, OR we selected a race that's not in the current filter,
			// we'll just select the first one in the list:
			if (chrCustRaceSelection.value.length == 0 || !listedRaceIDs.includes(chrCustRaceSelection.value[0].id))
				chrCustRaceSelection.value = [chrCustRaces.value[0]];
		}

		async function updateChrModelList() {
			const modelsForRace = d.chrRaceXChrModelMap.get(chrCustRaceSelection.value[0].id);

			// We'll do a quick check for the index of the last selected model.
			// If it's valid, we'll try to select the same index for loading the next race models.
			let selectionIndex = 0; //default is the first model

			// This is better than trying to search based on sex... for now. In the future if we
			// can update the model list without having to instantiate new objects, it will be more efficient
			// to try something else.
			if (chrCustModelSelection.value.length > 0) {
				const modelIDMap = chrCustModels.value.map((model) => { return model.id });
				selectionIndex = modelIDMap.indexOf(chrCustModelSelection.value[0].id);
			}

			// Done with the old list, so clear it
			chrCustModels.value = [];

			// Track model IDs to validate our previously selected model type
			const listedModelIDs = [];

			for (const [chrSex, chrModelID] of modelsForRace) {
				// Track the sex so we can reference it later, should the model/race have changed.
				const newModel = { id: chrModelID, label: 'Type ' + (chrSex + 1) };
				chrCustModels.value.push(newModel);
				listedModelIDs.push(chrModelID);
			}

			if (chrImportChrModelID.value != 0) {
				// If we have an imported character model, we'll try to select it.
				selectionIndex = listedModelIDs.indexOf(chrImportChrModelID.value);
				chrImportChrModelID.value = 0;
			} else {
				// If we haven't selected a model, we'll try to select the body type at the same index.
				// If the old selection is no longer valid, or the index is out of range, just set it to the first one.
				if (chrCustModels.value.length < selectionIndex || selectionIndex < 0)
					selectionIndex = 0;
			}


			// We've found the model index we want to load, so let's select it:
			chrCustModelSelection.value = [chrCustModels.value[selectionIndex]];
		}

		async function previewModel(fileDataID) {
			view.isBusy++;
			view.setToast('progress', 'Loading model, please wait...', null, -1, false);
			log.write('Previewing model %s', fileDataID);

			// Empty the arrays.
			view.modelViewerSkins.splice(0, view.modelViewerSkins.length);
			view.modelViewerSkinsSelection.splice(0, view.modelViewerSkinsSelection.length);

			try {
				// Dispose the currently active renderer.
				if (activeRenderer) {
					activeRenderer.dispose();
					activeRenderer = undefined;
					activeModel = undefined;
				}

				// Clear the active skin map.
				activeSkins.clear();

				// Reset skinned models
				for (const fileDataID of skinnedModelRenderers.keys()) {
					skinnedModelRenderers.get(fileDataID).dispose();
					skinnedModelRenderers.delete(fileDataID);
				}

				const file = await view.casc.getFile(fileDataID);

				activeRenderer = new M2Renderer(file, r.renderGroup, chrCustGeosets);

				await activeRenderer.load();
				//textureShaderMap = activeRenderer.shaderMap;
				updateCameraBounding();

				activeModel = fileDataID;

				// Renderer did not provide any 3D data.
				if (r.renderGroup.children.length === 0)
					view.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileDataID), null, 4000);
				else
					view.hideToast();

				await updateActiveCustomization();
			} catch (e) {
				// Error reading/parsing model.
				view.setToast('error', 'Unable to preview model ' + fileDataID, { 'View log': () => log.openRuntimelog() }, -1);
				log.write('Failed to open CASC file: %s', e.message);
			}

			view.isBusy--;
		}

		/** Update the camera to match render group bounding. */
		function updateCameraBounding() {
			// Get the bounding box for the model.
			const boundingBox = new THREE.Box3();
			boundingBox.setFromObject(r.renderGroup);

			// Calculate center point and size from bounding box.
			const center = boundingBox.getCenter(new THREE.Vector3());
			const size = boundingBox.getSize(new THREE.Vector3());

			const maxDim = Math.max(size.x, size.y, size.z);
			const fov = r.camera.fov * (Math.PI / 180);
			const cameraZ = (Math.abs(maxDim / 4 * Math.tan(fov * 2))) * 6;

			const heightOffset = maxDim * 0.7;
			r.camera.position.set(center.x, heightOffset, cameraZ);

			const minZ = boundingBox.min.z;
			const cameraToFarEdge = (minZ < 0) ? -minZ + cameraZ : cameraZ - minZ;

			r.camera.updateProjectionMatrix();

			const controls = view.modelViewerContext.controls;
			if (controls) {
				controls.target = center;
				controls.maxDistance = cameraToFarEdge * 2;
			}
		}

		async function importCharacter() {
			view.isBusy++;
			view.setToast('progress', 'Importing, please wait..', null, -1, false);

			const character_name = chrImportChrName.value; // string
			const selected_realm = chrImportSelectedRealm.value; // { label, value }
			const selected_region = chrImportSelectedRegion.value; // eu

			if (selected_realm === null) {
				view.setToast('error', 'Please enter a valid realm.', null, 3000);
				view.isBusy--;
				return;
			}

			const character_label = util.format('%s (%s-%s)', character_name, selected_region, selected_realm.label);
			const url = util.format(view.config.armoryURL, selected_region, selected_realm.value, encodeURIComponent(character_name.toLowerCase()));
			log.write('Retrieving character data for %s from %s', character_label, url);

			const res = await generics.get(url);
			if (res.ok) {
				try {
					loadImportJSON(await res.json());
					view.hideToast();
				} catch (e) {
					log.write('Failed to parse character data: %s', e.message);
					view.setToast('error', 'Failed to import character ' + character_label, null, -1);
				}
			} else {
				log.write('Failed to retrieve character data: %d %s', res.status, res.statusText);

				if (res.status == 404)
					view.setToast('error', 'Could not find character ' + character_label, null, -1);
				else
					view.setToast('error', 'Failed to import character ' + character_label, null, -1);
			}

			view.isBusy--;
		}

		async function loadImportString(importString) {
			loadImportJSON(JSON.parse(importString));
		}

		async function loadImportJSON(json) {
			//const selectedChrModelID = chrCustModelSelection.value[0].id;
			let playerRaceID = json.playable_race.id;

			// If the player is a Pandaren with a faction, we need to use the neutral Pandaren race.
			if (playerRaceID == 25 || playerRaceID == 26)
				playerRaceID = 24;

			// If the player is a Dracthyr (Horde), use Dracthyr (Alliance)
			if (playerRaceID == 70)
				playerRaceID = 52;

			// If the player is a Worgen or Dracthyr and the user wants to load the Visage model, remap.
			if (playerRaceID == 22 && chrImportLoadVisage.value)
				playerRaceID = 23;

			if (playerRaceID == 52 && chrImportLoadVisage.value)
				playerRaceID = 75;

			chrCustRaceSelection.value = [chrCustRaces.value.find(e => e.id === playerRaceID)];

			const playerGender = json.gender.type;
			let genderIndex = 0;
			if (playerGender == "MALE") {
				genderIndex = 0;
			} else if (playerGender == "FEMALE") {
				genderIndex = 1;
			} else {
				log.write('Failed to import character, encountered unknown player gender: %s', playerGender);
				view.setToast('error', 'Failed to import character, encountered unknown player gender: ' + playerGender, null, -1);
			}

			chrCustModelSelection.value = [chrCustModels.value[genderIndex]];

			// Get correct ChrModel ID
			const chrModelID = d.chrRaceXChrModelMap.get(playerRaceID).get(genderIndex);
			chrImportChrModelID.value = chrModelID;

			// Get available option IDs
			const availableOptions = d.optionsByChrModel.get(chrModelID);
			const availableOptionsIDs = [];
			for (const option of availableOptions)
				availableOptionsIDs.push(option.id);

			// Reset last imported choices.
			chrImportChoices.value = [];

			const parsedChoices = [];
			for (const customizationEntry of Object.values(json.customizations)) {
				if (!availableOptionsIDs.includes(customizationEntry.option.id))
					continue;

				parsedChoices.push({optionID: customizationEntry.option.id, choiceID: customizationEntry.choice.id});
			}

			chrImportChoices.value.push(...parsedChoices);
		}

		const exportCharModel = async () => {
			const exportPaths = core.openLastExportStream();

			const casc = view.casc;
			const helper = new ExportHelper(1, 'model');
			helper.start();

			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			const fileDataID = activeModel;
			const fileName = listfile.getByID(fileDataID);

			const fileManifest = [];

			try {
				const data = await casc.getFile(fileDataID);
				const exportPath = ExportHelper.replaceExtension(ExportHelper.getExportPath(fileName), ".gltf");
				const exporter = new M2Exporter(data, [], fileDataID);

				for (const [chrModelTextureTarget, chrMaterial] of chrMaterials.value)
					exporter.addURITexture(chrModelTextureTarget, chrMaterial.getURI());

				// Respect geoset masking for selected model.
				exporter.setGeosetMask(chrCustGeosets.value);

				await exporter.exportAsGLTF(exportPath, helper, fileManifest);
				await exportPaths?.writeLine('M2_GLTF:' + exportPath);

				// Abort if the export has been cancelled.
				if (helper.isCancelled())
					return;

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message, e.stack);
			}


			helper.finish();

			// Write export information.
			exportPaths?.close();
		};

		async function updateModelSelection() {
			const selected = chrCustModelSelection.value[0];
			if (selected === undefined)
				return;

			console.log('Selection changed to ID ' + selected.id + ', label ' + selected.label);

			const availableOptions = d.optionsByChrModel.get(selected.id);
			if (availableOptions === undefined) {
				console.log('No options available for this model.');
				return;
			}

			// Empty the arrays.
			chrCustOptions.value = [];
			chrCustOptionSelection.value = [];

			// Reset active choices
			chrCustActiveChoices.value = [];

			if (chrImportChoices.value.length > 0)
				chrCustActiveChoices.value.push(...chrImportChoices.value);

			// Add the new options.
			chrCustOptions.value.push(...availableOptions);
			chrCustOptionSelection.value.push(...availableOptions.slice(0, 1));

			console.log("Set currentCharComponentTextureLayoutID to " + currentCharComponentTextureLayoutID);
			currentCharComponentTextureLayoutID = d.chrModelIDToTextureLayoutID.get(selected.id);

			const fileDataID = d.chrModelIDToFileDataID.get(selected.id);

			// Check if the first file in the selection is "new".
			if (!view.isBusy && fileDataID && activeModel !== fileDataID)
				previewModel(fileDataID);

			clearMaterials();

			if (chrImportChoices.value.length == 0) {
				// For each available option we select the first choice ONLY if the option is a 'default' option.
				// TODO: What do we do if the user doesn't want to select any choice anymore? Are "none" choices guaranteed for these options?
				for (const option of availableOptions) {
					const choices = d.optionToChoices.get(option.id);
					if (d.defaultOptions.includes(option.id))
						chrCustActiveChoices.value.push({ optionID: option.id, choiceID: choices[0].id });
				}
			} else {
				chrImportChoices.value = [];
			}
		}

		function clearMaterials() {
			for (const chrMaterial of chrMaterials.value.values())
				chrMaterial.dispose();

			chrMaterials.value.clear();
		}

		async function updateCustomizationType() {
			const selection = chrCustOptionSelection.value;

			if (selection.length === 0)
				return;

			const selected = selection[0];

			const availableChoices = d.optionToChoices.get(selected.id);
			if (availableChoices === undefined)
				return;

			chrCustUnsupportedWarning.value = false;

			for (const choice of availableChoices) {
				if (d.unsupportedChoices.includes(choice.id))
					chrCustUnsupportedWarning.value = true;
			}

			chrCustChoices.value = availableChoices.slice();
			chrCustChoiceSelection.value = [];
		}

		async function updateCustomizationChoice() {
			const selection = chrCustChoiceSelection.value;
			if (selection.length === 0)
				return;

			const selected = selection[0];
			console.log('Choice selection for option ID ' + chrCustOptionSelection.value[0].id + ', label ' + chrCustOptionSelection.value[0].label + ' changed to choice ID ' + selected.id + ', label ' + selected.label);
			if (chrCustActiveChoices.value.find((choice) => choice.optionID === chrCustOptionSelection.value[0].id) === undefined) {
				chrCustActiveChoices.value.push({ optionID: chrCustOptionSelection.value[0].id, choiceID: selected.id });
			} else {
				const index = chrCustActiveChoices.value.findIndex((choice) => choice.optionID === chrCustOptionSelection.value[0].id);
				chrCustActiveChoices.value[index].choiceID = selected.id;
			}
		}

		// If NPC race toggle changes, refresh model list.
		watch(() => view.config.chrCustShowNPCRaces, updateChrRaceList);

		watch(() => view.config.chrIncludeBaseClothing, uploadRenderOverrideTextures);

		// User has changed the "Race" selection, ie "Human", "Orc", etc.
		watch(chrCustRaceSelection, updateChrModelList);

		// User has changed the "Body Type" selection, ie "Type 1", "Type 2", etc.
		watch(chrCustModelSelection, updateModelSelection, { deep: true });

		// User has changed the "Customization" selection, ie "Hair Color", "Skin Color", etc.
		watch(chrCustOptionSelection, updateCustomizationType, { deep: true });

		// User has changed the "Customization Options" selection, ie "Choice 0", "Choice 1", etc.
		watch(chrCustChoiceSelection, updateCustomizationChoice, { deep: true });

		watch(chrCustActiveChoices, async () => {
			if (view.isBusy)
				return;

			await updateActiveCustomization();
		}, { deep: true });

		// Expose loadImportString for debugging purposes.
		window.loadImportString = loadImportString;

		// Export shader reset for debugging purposes.
		window.reloadShaders = async () => {
			await CharMaterialRenderer.init();

			for (const material of chrMaterials.value.values())
				await material.compileShaders();

			await uploadRenderOverrideTextures();
		}

		return {
			view,
			config: view.config,
			isLoaded,
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
			chrImportSelectedRegion,
			chrImportRealms,
			chrImportSelectedRealm,
			chrImportLoadVisage,
			chrImportChrModelID,
			chrImportChoices,
			chrMaterials,
			importCharacter,
			exportCharModel,
		};
	},
	template: `
		<div class="tab" id="tab-characters" v-if="isLoaded">
			<div class="left-panel">
				<div class="tab-control">
					<span @click="chrCustTab = 'models'" :class="{ selected: chrCustTab === 'models' }">Models</span>
					<span @click="chrCustTab = 'options'" :class="{ selected: chrCustTab === 'options' }">Options</span>
				</div>
				<div class="model-tab" v-show="chrCustTab  === 'models'">
					<span class="header">Character Race
						<label class="ui-checkbox" id="inline-npc-races">
							<input type="checkbox" v-model="config.chrCustShowNPCRaces" />
							<span>Show NPC races</span>
						</label>
					</span>
					<listboxb id="listbox-chr-race" class="section-end" :items="chrCustRaces" v-model:selection="chrCustRaceSelection" :single="true" :disable="view.isBusy"></listboxb>
					<span class="header">Body Type</span>
					<listboxb id="listbox-chr-model" :items="chrCustModels" v-model:selection="chrCustModelSelection" :single="true"></listboxb>
				</div>
				<div class="option-tab" v-show="chrCustTab  === 'options'">
					<span class="header">Customizations</span>
					<listboxb id="listbox-chr-option" :items="chrCustOptions" v-model:selection="chrCustOptionSelection" :single="true"></listboxb>
					<span class="header">Customization Options</span>
					<listboxb id="listbox-chr-choice" :items="chrCustChoices" v-model:selection="chrCustChoiceSelection" :single="true"></listboxb>
					<p id="chrCustUnsupportedText" v-show="chrCustUnsupportedWarning">Options with * use unsupported features and might not display/export correctly.</p>
				</div>
			</div>
			<div class="char-preview preview-container">
				<div class="preview-background">
					<model-viewer :context="chrModelViewerContext"></model-viewer>
				</div>
				<texture-overlay :materials="chrMaterials" v-if="config.chrShowTextureOverlay"></texture-overlay>
			</div>
			<div class="right-panel">
				<div class="tab-control">
					<span @click="chrCustRightTab = 'geosets'" :class="{ selected: chrCustRightTab === 'geosets' }">Geosets</span>
					<span @click="chrCustRightTab = 'import'" :class="{ selected: chrCustRightTab === 'import' }">Import</span>
				</div>
				<div id="character-import-panel" v-if="chrCustRightTab == 'import'">
					<div class="header"><b>Character Import</b></div>
					<ul class="ui-multi-button">
						<li v-for="region of chrImportRegions" :class="{ selected: chrImportSelectedRegion === region }" @click.stop="chrImportSelectedRegion = region">{{ region.toUpperCase() }}</li>
					</ul>
					<input type="text" v-model="chrImportChrName" placeholder="Character Name"/>
					<combo-box v-model:value="chrImportSelectedRealm" :source="chrImportRealms" placeholder="Character Realm" maxheight="10"></combo-box>
					<label class="ui-checkbox" title="Load visage model (Dracthyr/Worgen)">
						<input type="checkbox" v-model="chrImportLoadVisage"/>
						<span>Load visage model (Dracthyr/Worgen)</span>
					</label>
					<input type="button" value="Import Character" @click="importCharacter" :class="{ disabled: view.isBusy }"/>
				</div>
				<div v-if="chrCustRightTab == 'geosets'">
					<div class="header"><b>Geosets</b></div>
					<p>Only touch geosets <b>after</b> customizing the character to prevent conflicts.</p>
					<checkboxlist id="checkbox-geosets" :items="chrCustGeosets"></checkboxlist>
					<div class="list-toggles">
						<a @click="view.setAllGeosets(true, chrCustGeosets)">Enable All</a> / <a @click="view.setAllGeosets(false, chrCustGeosets)">Disable All</a>
					</div>
				</div>
				<label class="ui-checkbox" title="Include Animations in Export">
					<input type="checkbox" v-model="config.modelsExportAnimations"/>
					<span>Export animations</span>
				</label>
				<label class="ui-checkbox" title="Include Base Clothing">
					<input type="checkbox" v-model="config.chrIncludeBaseClothing"/>
					<span>Include base clothing</span>
				</label>
				<label class="ui-checkbox" title="Show Texture Overlay">
					<input type="checkbox" v-model="config.chrShowTextureOverlay"/>
					<span>Show texture overlay</span>
				</label>
				<input type="button" id="export-char-btn" value="Export glTF" @click="exportCharModel" :class="{ disabled: view.isBusy }"/>
			</div>
		</div>
	`
}