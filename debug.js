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

function adjustRequireSrc(ast, id) {
	recast.types.visit(ast, {
		visitCallExpression(sourcePath) {
			const node = sourcePath.node;
			if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
				const [arg] = node.arguments;
				if (arg.type === 'StringLiteral' && arg.value.startsWith('.'))
					arg.value = path.join(path.dirname(id), arg.value).substring(1).replace(/\\/g, '/');
				else if (arg.type === 'StringLiteral' && arg.value.startsWith('/'))
					arg.value = path.join('src', arg.value.substring(1)).replace(/\\/g, '/');
			}
			this.traverse(sourcePath);
		}
	});
}

function addVueHmrId(ast, id) {
	id = JSON.stringify(id);
	let hasAdded = false;

	recast.types.visit(ast, {
		visitExportDefaultDeclaration(sourcePath) {
			const node = sourcePath.node;
			if (node.declaration.type === 'ObjectExpression' &&
					// detect vue component by default export with `template` and (`setup` or `data`) properties
					node.declaration.properties.filter(
						prop => (
							prop.key.type === 'Identifier' && (
								prop.key.name === 'template' ||
								prop.key.name === 'setup' ||
								prop.key.name === 'data'
							)
						)
					).length >= 2
			) {
				const hmrIdAst = recast.parse(`!{__hmrId: ${id}}`);
				node.declaration.properties.push(...hmrIdAst.program.body[0].expression.argument.properties);
				hasAdded = true;
			}
			this.traverse(sourcePath);
		}
	});

	if (hasAdded) {
		const astHot = recast.parse(`
if (import.meta.hot) {
	import.meta.hot.accept((newModule) => {
		if (newModule == null)
			return;

		__VUE_HMR_RUNTIME__.reload(${id}, newModule.default);
	});
}`, { parser });

		ast.program.body.push(...astHot.program.body);
	}

	return hasAdded;
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

			if (isModule && !code.includes('import.meta.hot') && addVueHmrId(ast, relativeId))
				console.log('vue-hmr:', relativeId);

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
	const nwProcess = childProcess.spawn(nwPath, { stdio: 'inherit', env: {...process.env, VITE_PORT: vitePort} });

	// When the spawned process is closed, exit the Node.js process as well
	nwProcess.on('close', code => {
		process.exit(code);
	});
})();