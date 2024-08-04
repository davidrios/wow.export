const path = require('path');
const fsp = require('fs').promises;

const { exportFiles } = require('./ui/tab-textures');

const collectFiles = async (dir, out = []) => {
	const entries = await fsp.opendir(dir);
	for await (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory())
			await collectFiles(entryPath, out);
		else
			out.push(entryPath);
	}

	return out;
};

export async function reexportTextures(view) {
	if (view.casc == null)
		return;

	const exportedTextures = (await collectFiles(view.config.exportDirectory))
		.filter(item => item.endsWith('.png'))
		.map(item => item.substring(view.config.exportDirectory.length + 1).replace('.png', '.blp'));

	exportFiles(exportedTextures, false, -1, false);
}