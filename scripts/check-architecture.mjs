import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoots = ['frontend/src', 'backend/src', 'shared/src', 'services/exposure-archive/src', 'functions'];
const features = new Set(['exposure', 'monitor', 'portfolios', 'recovery']);
const neutral = new Set(['events', 'browser']);
const entrypoints = new Set(['frontend/src/main.tsx', 'frontend/src/exposure/main.tsx']);

// Focused allowances preserve existing data/helper ownership. New feature presentation or
// lifecycle dependencies require an explicit decision here, rather than unrestricted imports.
const featureAllowances = {
  exposure: new Set(['monitor/hazard-screening.ts']),
  monitor: new Set(['exposure/live.ts', 'exposure/evidence.ts']),
  portfolios: new Set(['exposure/model.ts', 'exposure/fixtures.ts', 'exposure/portfolio.ts', 'exposure/evidence.ts']),
};
// These consumers use Exposure's data shapes, never its runtime schemas/calculations.
const exposureTypeConsumers = new Set(['monitor', 'recovery', 'components']);
const mapComposition = new Set([
  'exposure/model.ts', 'exposure/useExposureMap.ts', 'recovery/parametric/types.ts', 'recovery/useRecoveryMap.ts',
  'monitor/map.ts', 'monitor/LayerToggle.tsx', 'monitor/fire-icon.ts', 'monitor/FireMapCard.tsx',
  'monitor/MonitorLayerControls.tsx', 'portfolios/geocoding.ts',
]);
const slash = value => value.split(path.sep).join('/');
const inDirectory = (file, directory) => file.startsWith(`${directory}/`);
const frontendPath = file => inDirectory(file, 'frontend/src') ? file.slice('frontend/src/'.length) : null;
const group = file => frontendPath(file)?.split('/')[0];
const application = file => {
  if (inDirectory(file, 'frontend/src')) return 'frontend';
  if (inDirectory(file, 'backend/src')) return 'backend';
  if (inDirectory(file, 'services/exposure-archive/src')) return 'archive';
  if (inDirectory(file, 'functions')) return 'functions';
  return null;
};

function policyViolation(edge) {
  const { from, to } = edge;
  const sourceApplication = application(from), targetApplication = application(to);
  if (inDirectory(from, 'shared') && !inDirectory(to, 'shared')) return ['shared-isolation', 'The shared package cannot depend on application or tooling internals.'];
  if (sourceApplication && targetApplication && sourceApplication !== targetApplication) return ['package-isolation', 'Application packages must not import another runtime application’s internals. Use shared contracts or a transport adapter.'];
  if (sourceApplication !== 'frontend' || targetApplication !== 'frontend') return null;
  const sourceGroup = group(from), targetGroup = group(to), target = frontendPath(to);
  if (targetGroup === 'app' && sourceGroup !== 'app') {
    if (entrypoints.has(from) && target === 'app/mount.tsx') return null;
    return ['app-ownership', 'Only the two browser entrypoints may import app/mount; feature and shared modules cannot import app internals.'];
  }
  if (neutral.has(sourceGroup) && !neutral.has(targetGroup)) return ['neutral-independence', 'Events and browser modules must remain independent of feature, presentation and application modules.'];
  if (sourceGroup === targetGroup || sourceGroup === 'app' || !features.has(targetGroup)) return null;
  if (target === 'exposure/model.ts' && exposureTypeConsumers.has(sourceGroup) && edge.typeOnly) return null;
  if (features.has(sourceGroup) && featureAllowances[sourceGroup]?.has(target)) return null;
  if (from === 'frontend/src/maps/WorkbenchMap.tsx' && mapComposition.has(target)) return null;
  return ['feature-dependency', `Importing ${target} is not an approved data, helper or rendering dependency for ${sourceGroup}.`];
}

function importedModules(source) {
  const imports = [];
  const add = (literal, typeOnly, node) => imports.push({ specifier: literal.text, typeOnly, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  const visit = node => {
    if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = Boolean(clause?.isTypeOnly || (clause && !clause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length && bindings.elements.every(element => element.isTypeOnly)));
      add(node.moduleSpecifier, typeOnly, node);
    } else if (ts.isExportDeclaration(node) && literal(node.moduleSpecifier)) {
      const exports = node.exportClause;
      const typeOnly = Boolean(node.isTypeOnly || (exports && ts.isNamedExports(exports) && exports.elements.length && exports.elements.every(element => element.isTypeOnly)));
      add(node.moduleSpecifier, typeOnly, node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && literal(node.moduleReference.expression)) {
      add(node.moduleReference.expression, node.isTypeOnly, node);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && literal(node.argument.literal)) {
      add(node.argument.literal, true, node);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      if (literal(node.arguments[0])) add(node.arguments[0], false, node);
      else imports.push({ specifier: null, typeOnly: false, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function runtimeCycles(files, edges) {
  const adjacency = new Map(files.map(file => [file, []]));
  for (const edge of edges) if (!edge.typeOnly && adjacency.has(edge.to)) adjacency.get(edge.from)?.push(edge.to);
  let nextIndex = 0;
  const indices = new Map(), low = new Map(), stack = [], stacked = new Set(), cycles = [];
  const visit = file => {
    indices.set(file, nextIndex); low.set(file, nextIndex++); stack.push(file); stacked.add(file);
    for (const target of adjacency.get(file)) {
      if (!indices.has(target)) { visit(target); low.set(file, Math.min(low.get(file), low.get(target))); }
      else if (stacked.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)));
    }
    if (low.get(file) !== indices.get(file)) return;
    const members = [];
    let member;
    do { member = stack.pop(); stacked.delete(member); members.push(member); } while (member !== file);
    if (members.length > 1 || adjacency.get(file).includes(file)) cycles.push(members.sort());
  };
  for (const file of files) if (!indices.has(file)) visit(file);
  return cycles;
}

/** Inspect production modules using the same TypeScript resolver as the project. */
export function checkArchitecture(root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  root = realpathSync(root);
  const files = [], edges = [], violations = [];
  const walk = directory => {
    if (!existsSync(directory)) return;
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, item.name);
      if (item.isDirectory() && item.name !== '__tests__') walk(file);
      else if (item.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) && !/\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(file)) files.push(file);
    }
  };
  sourceRoots.forEach(directory => walk(path.join(root, directory)));
  const optionsCache = new Map();
  const compilerOptions = file => {
    const config = ts.findConfigFile(path.dirname(file), ts.sys.fileExists);
    if (!config) return { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, resolveJsonModule: true, allowJs: true };
    if (!optionsCache.has(config)) {
      const read = ts.readConfigFile(config, ts.sys.readFile);
      if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(config));
      optionsCache.set(config, parsed.options);
    }
    return optionsCache.get(config);
  };
  for (const file of files) {
    const from = slash(path.relative(root, file));
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const imported of importedModules(source)) {
      if (imported.specifier === null) {
        violations.push({ rule: 'uncheckable-import', from, line: imported.line, message: 'Computed import/require specifiers cannot be checked. Use an explicit literal module path.' });
        continue;
      }
      const specifier = imported.specifier.replace(/[?#].*$/, '');
      // Vite resolves leading-slash imports against the frontend project root.
      // Give TypeScript that same absolute path so these imports cannot bypass policy.
      const rootRelative = specifier.startsWith('/');
      const modulePath = rootRelative && application(from) === 'frontend'
        ? path.join(root, 'frontend', specifier.slice(1)) : specifier;
      let resolved = ts.resolveModuleName(modulePath, file, compilerOptions(file), ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved && (specifier.startsWith('.') || rootRelative)) {
        const asset = path.resolve(path.dirname(file), modulePath);
        if (existsSync(asset) && statSync(asset).isFile()) resolved = asset;
      }
      if (!resolved) {
        if (specifier.startsWith('.') || rootRelative) violations.push({ rule: 'unresolved-import', from, line: imported.line, message: `Cannot resolve local import ${imported.specifier}.` });
        continue; // External packages are owned by their own package, not this import graph.
      }
      const to = slash(path.relative(root, resolved));
      if (to.startsWith('../') || to.split('/').includes('node_modules')) continue;
      const edge = { from, to, line: imported.line, typeOnly: imported.typeOnly, specifier: imported.specifier };
      edges.push(edge);
      const violation = policyViolation(edge);
      if (violation) violations.push({ rule: violation[0], from, to, line: edge.line, message: violation[1] });
    }
  }
  const relativeFiles = files.map(file => slash(path.relative(root, file)));
  for (const members of runtimeCycles(relativeFiles, edges)) violations.push({ rule: 'runtime-cycle', from: members[0], message: `Runtime import cycle among: ${members.join(', ')}` });
  return { files: relativeFiles, edges, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkArchitecture();
  for (const item of result.violations) console.error(`${item.from}${item.line ? `:${item.line}` : ''} [${item.rule}] ${item.message}${item.to ? ` (${item.to})` : ''}`);
  if (result.violations.length) process.exitCode = 1;
  else console.log(`Architecture checks passed: ${result.files.length} production modules, ${result.edges.length} local imports, no prohibited dependencies or runtime cycles.`);
}
