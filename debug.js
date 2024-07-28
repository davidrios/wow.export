const fs = require('fs');
const path = require('path');
const sass = require('sass');
const childProcess = require('child_process');
const waitOn = require('wait-on');
const vite = require('vite');
const recast = require('recast');
const parser = require('recast/parsers/babel');

const argv = process.argv.splice(2);
const isHmr = argv[0] === 'hmr';
const vitePort = isHmr ? argv[1] ?? 4175 : null;

const nwPath = `./bin/win-x64-debug${isHmr ? '-hmr' : ''}/nw.exe`;
const srcDir = './src/';
const appScss = './src/app.scss';

function convertModuleImport(moduleImport, relativeBase) {
	if (moduleImport.startsWith('.'))
		return path.join(path.dirname(relativeBase), moduleImport).substring(1).replace(/\\/g, '/');
	else if (moduleImport.startsWith('/'))
		return path.join('src', moduleImport.substring(1)).replace(/\\/g, '/');
}

function adjustRequireSrc(ast, id) {
	recast.types.visit(ast, {
		visitCallExpression(sourcePath) {
			const node = sourcePath.node;
			if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
				const [arg] = node.arguments;
				if (arg.type === 'StringLiteral') {
					const converted = convertModuleImport(arg.value, id);
					if (converted != null)
						arg.value = converted;
				}
			}
			this.traverse(sourcePath);
		}
	});
}

function getVueComponent(ast) {
	let retDecl = null;

	recast.types.visit(ast, {
		visitObjectExpression(sourcePath) {
			const decl = sourcePath.value;

			// detect vue component by default export with `template` and (`setup` or `data`) properties
			let hasTemplate = false;
			let hasSetupData = false;
			for (const prop of decl.properties) {
				if (prop.key.type !== 'Identifier')
					continue;

				hasTemplate = hasTemplate || prop.key.name === 'template';
				hasSetupData = hasSetupData || prop.key.name === 'setup' || prop.key.name === 'data';
			}

			if (hasTemplate && hasSetupData) {
				retDecl = decl;
				return false;
			}

			this.traverse(sourcePath);
		}
	});

	return retDecl;
}

function addVueHmr(ast, id) {
	let components = new Set();
	const b = recast.types.builders;

	const variableDeclarations = Object.fromEntries(
		ast.program.body
			.filter(node => node.type === 'VariableDeclaration')
			.map(node => [node.declarations[0].id.name, node])
	);

	for (let i = 0; i < ast.program.body.length; i++) {
		const node = ast.program.body[i];
		if (!node.type.startsWith('Export'))
			continue;

		try {
			let vueComponent = getVueComponent(node);
			if (vueComponent == null) {
				const variableName = node.declaration.name ?? (node.declaration.declarations ?? '')[0]?.init?.name;
				const variable = variableDeclarations[variableName]
				if (variableName == null || variable == null)
					continue;

				vueComponent = getVueComponent(variable);
				if (vueComponent == null)
					continue
			}

			const name = node.type === 'ExportDefaultDeclaration'
				? 'default'
				: node.declaration.declarations[0].id.name;

			const componentId = `${id}:${name}`;
			components.add([componentId, name]);

			vueComponent.properties.push(b.objectProperty(
				b.identifier('__hmrId'),
				b.stringLiteral(componentId)));
		} catch (e) {
			console.error(e);
		}
	}

	if (components.size > 0) {
		const astHot = recast.parse(`
if (import.meta.hot) {
	import.meta.hot.accept((newModule) => {
		if (newModule == null)
			return;

		${Array.from(components.values())
		.map(([componentId, name]) => `__VUE_HMR_RUNTIME__.reload(${JSON.stringify(componentId)}, newModule.${name})`)
		.join(';')};
	});
}`, { parser });

		ast.program.body.push(...astHot.program.body);

		return true;
	}
}

(async () => {
	// Check if nw.exe exists
	try {
		await fs.promises.access(nwPath);
	} catch (err) {
		throw new Error('Could not find debug executable at %s, ensure you have run `node build win-x64-debug` first.', nwPath);
	}

	// Locate all .scss files under /src/
	const scssFiles = (await fs.promises.readdir(srcDir)).filter(file => file.endsWith('.scss'));

	// Recompile app.scss on startup.
	try {
		const result = sass.compile(appScss);
		await fs.promises.writeFile(appScss.replace('.scss', '.css'), result.css);
	} catch (err) {
		console.error('Failed to compile application css: %s', err);
	}

	// Monitor the .scss files for changes
	scssFiles.forEach(file => {
		fs.watchFile(path.join(srcDir, file), async () => {
			console.log('Detected change in %s, recompiling...', file);
			// If there are any changes in any of the .scss files, recompile app.scss.
			try {
				const result = sass.compile(appScss);
				await fs.promises.writeFile(appScss.replace('.scss', '.css'), result.css);
			} catch (err) {
				console.error('Failed to compile application css: %s', err);
			}
		});
	});

	const vueHmr = {
		name: 'vue-hmr',
		async transformIndexHtml(html) {
			return html.replace(
				'<script defer type="text/javascript" src="app.js"></script>',
				'<script type="module" src="app-loader.js"></script>'
			);
		},
		async transform(code, id) {
			const relativeId = id.substring(path.resolve(__dirname).length);
			const isModule = relativeId.endsWith('.mjs');

			if (!(relativeId.startsWith('/src') && (isModule || relativeId === '/src/init.js')))
				return;

			const ast = recast.parse(code, { sourceFileName: id, parser });
			adjustRequireSrc(ast, relativeId);

			if (isModule && !code.includes('import.meta.hot')) {
				if (addVueHmr(ast, relativeId))
					console.log('vue-hmr:', relativeId);
			}

			return recast.print(ast, { sourceMapName: id });
		},
	}

	if (isHmr) {
		const viteServer = await vite.createServer({
			configFile: false,
			root: path.join(__dirname, srcDir),
			server: { port: vitePort },
			plugins: [vueHmr],
			sourcemap: true,
		})
		viteServer.listen();

		await waitOn({
			resources: [`http-get://localhost:${vitePort}`],
			headers: { 'accept': 'text/html' },
		});
	}

	// Launch nw.exe
	const nwProcess = childProcess.spawn(nwPath, { stdio: 'inherit', env: { ...process.env, VITE_PORT: vitePort } });

	// When the spawned process is closed, exit the Node.js process as well
	nwProcess.on('close', code => {
		process.exit(code);
	});
})();