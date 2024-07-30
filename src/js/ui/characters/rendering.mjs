const CharMaterialRenderer = require('/js/3D/renderers/CharMaterialRenderer');

let shared = null;

export default async function(view) {
	if (shared != null)
		return shared;

	view.setToast('progress', 'Loading character shaders...', null, -1, false);
	await CharMaterialRenderer.init();

	const renderGroup = new THREE.Group();

	// Initialize model viewer.
	const camera = new THREE.PerspectiveCamera(70, undefined, 0.01, 2000);

	const scene = new THREE.Scene();
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 1);
	scene.add(light);
	scene.add(renderGroup);

	const grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);

	if (view.config.modelViewerShowGrid)
		scene.add(grid);

	// WoW models are by default facing the wrong way; rotate everything.
	renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	const modelViewerContext = Object.seal({ camera, scene, controls: null });

	shared = {
		camera,
		renderGroup,
		modelViewerContext,
	};

	view.hideToast();
	return shared;
}