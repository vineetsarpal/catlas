import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkArchitecture } from './check-architecture.mjs';

function fixture(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'catlas-architecture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', resolveJsonModule: true,
    baseUrl: '.', paths: { '@catlas/shared/*': ['shared/src/*'], '@server/*': ['backend/src/*'] } } };
  for (const [name, text] of Object.entries({ 'tsconfig.json': JSON.stringify(config), ...files })) {
    const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text);
  }
  return checkArchitecture(root);
}
const rules = result => result.violations.map(item => item.rule);

test('current feature data/helpers, shared contracts, neutral data and the map composition are permitted', t => {
  const result = fixture(t, {
    'shared/src/contracts.ts': 'export type Contract = { id: string };',
    'frontend/src/events/model.ts': "import type { Contract } from '@catlas/shared/contracts'; export type Event = Contract;",
    'frontend/src/browser/download.ts': 'export const download = () => {};',
    'frontend/src/exposure/model.ts': 'export const schema = {}; export type Row = { id: string };',
    'frontend/src/exposure/live.ts': 'export const load = () => [];',
    'frontend/src/exposure/relevance.ts': "import { screen } from '../monitor/hazard-screening'; export { screen };",
    'frontend/src/monitor/hazard-screening.ts': 'export const screen = () => true;',
    'frontend/src/monitor/session.ts': "import { load } from '../exposure/live'; import type { Row } from '../exposure/model'; export const session = load; export type Result = Row;",
    'frontend/src/portfolios/inventory.ts': "import { schema } from '../exposure/model'; export { schema };",
    'frontend/src/components/LocationDetails.tsx': "import type { Row } from '../exposure/model'; export type Details = Row;",
    'frontend/src/recovery/useRecoveryMap.ts': 'export const useRecoveryMap = () => {};',
    'frontend/src/maps/WorkbenchMap.tsx': "import { useRecoveryMap } from '../recovery/useRecoveryMap'; export const map = useRecoveryMap;",
    'backend/src/index.ts': "import type { Contract } from '@catlas/shared/contracts'; export type Input = Contract;",
  });
  assert.deepEqual(result.violations, []);
  assert.ok(result.edges.some(edge => edge.to === 'shared/src/contracts.ts'));
});

test('only the two actual browser entrypoints may import app/mount', t => {
  const result = fixture(t, {
    'frontend/src/app/mount.tsx': 'export const mountWorkbench = () => {};',
    'frontend/src/app/Workbench.tsx': 'export const Workbench = () => null;',
    'frontend/src/main.tsx': "import { mountWorkbench } from './app/mount'; mountWorkbench();",
    'frontend/src/exposure/main.tsx': "import { mountWorkbench } from '../app/mount'; mountWorkbench();",
    'frontend/src/monitor/main.tsx': "import { mountWorkbench } from '../app/mount'; mountWorkbench();",
    'frontend/src/components/Bad.ts': "import type { Workbench } from '../app/Workbench'; export type Bad = typeof Workbench;",
  });
  assert.equal(result.violations.length, 2);
  assert.deepEqual(new Set(result.violations.map(item => item.from)), new Set(['frontend/src/monitor/main.tsx', 'frontend/src/components/Bad.ts']));
  assert.deepEqual(rules(result), ['app-ownership', 'app-ownership']);
});

test('entrypoint exemption cannot import arbitrary app internals', t => {
  const result = fixture(t, {
    'frontend/src/app/Workbench.tsx': 'export const workbench = 1;',
    'frontend/src/main.tsx': "export { workbench } from './app/Workbench';",
  });
  assert.deepEqual(rules(result), ['app-ownership']);
});

test('neutral events and browser modules cannot depend on feature or presentation modules, even for types', t => {
  const result = fixture(t, {
    'frontend/src/events/model.ts': "import type { Model } from '../recovery/model'; export type Event = Model;",
    'frontend/src/browser/download.ts': "export { Button } from '../components/Button';",
    'frontend/src/recovery/model.ts': 'export type Model = {};',
    'frontend/src/components/Button.tsx': 'export const Button = () => null;',
  });
  assert.deepEqual(rules(result), ['neutral-independence', 'neutral-independence']);
});

test('cross-feature presentation/lifecycle imports and unapproved shared-to-feature imports are rejected', t => {
  const result = fixture(t, {
    'frontend/src/exposure/lifecycle.ts': 'export const lifecycle = {};',
    'frontend/src/recovery/RecoveryWorkbench.tsx': 'export const Recovery = {};',
    'frontend/src/portfolios/inventory.ts': "import { lifecycle } from '../exposure/lifecycle'; export { lifecycle };",
    'frontend/src/monitor/view.ts': "import { Recovery } from '../recovery/RecoveryWorkbench'; export { Recovery };",
    'frontend/src/components/Bad.tsx': "import { lifecycle } from '../exposure/lifecycle'; export { lifecycle };",
  });
  assert.equal(result.violations.length, 3);
  assert.ok(rules(result).every(rule => rule === 'feature-dependency'));
});

test('renderer composition allowance belongs to the shared map host only', t => {
  const result = fixture(t, {
    'frontend/src/exposure/useExposureMap.ts': 'export const render = () => {};',
    'frontend/src/maps/WorkbenchMap.tsx': "import { render } from '../exposure/useExposureMap'; export { render };",
    'frontend/src/maps/geography.ts': "import { render } from '../exposure/useExposureMap'; export { render };",
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].from, 'frontend/src/maps/geography.ts');
  assert.equal(result.violations[0].rule, 'feature-dependency');
});

test('runtime packages cannot import each other and shared cannot import application internals', t => {
  const result = fixture(t, {
    'frontend/src/exposure/model.ts': 'export type Model = {};',
    'frontend/src/exposure/read.ts': "import { server } from '@server/app'; export { server };",
    'backend/src/app.ts': 'export const server = {};',
    'shared/src/leak.ts': "import type { Model } from '../../frontend/src/exposure/model'; export type Leaked = Model;",
    'functions/leak.ts': "export { server } from '../backend/src/app';",
    'services/exposure-archive/src/leak.ts': "export { server } from '../../../backend/src/app';",
  });
  assert.deepEqual(rules(result).sort(), ['package-isolation', 'package-isolation', 'package-isolation', 'shared-isolation']);
});

test('static runtime cycles are reported, including self-imports', t => {
  const result = fixture(t, {
    'frontend/src/exposure/a.ts': "import { b } from './b'; export const a = b;",
    'frontend/src/exposure/b.ts': "import { a } from './a'; export const b = a;",
    'frontend/src/monitor/self.ts': "export * from './self';",
  });
  assert.equal(result.violations.length, 2);
  assert.ok(rules(result).every(rule => rule === 'runtime-cycle'));
  assert.ok(result.violations.some(item => item.message.includes('frontend/src/exposure/a.ts, frontend/src/exposure/b.ts')));
});

test('declaration, named type-only and import-type cycles do not become runtime cycles', t => {
  const result = fixture(t, {
    'frontend/src/exposure/a.ts': "import type { B } from './b'; export type A = { value: B };",
    'frontend/src/exposure/b.ts': "export { type A } from './a'; export type B = import('./a').A;",
    'frontend/src/monitor/a.ts': "import { type B } from './b'; export type A = B;",
    'frontend/src/monitor/b.ts': "import type { A } from './a'; export type B = A;",
  });
  assert.deepEqual(result.violations, []);
  assert.ok(result.edges.every(edge => edge.typeOnly));
});

test('literal dynamic imports, require, import-equals and re-exports participate in policy and cycle checks', t => {
  const result = fixture(t, {
    'frontend/src/exposure/a.ts': "export const load = () => import('./b');",
    'frontend/src/exposure/b.ts': "export { load } from './a';",
    'frontend/src/monitor/reexport.ts': "export * from '../app/mount';",
    'frontend/src/monitor/namespace.ts': "export * as Mount from '../app/mount';",
    'frontend/src/monitor/equals.ts': "import Mount = require('../app/mount'); export { Mount };",
    'frontend/src/monitor/require.ts': "export const mount = require('../app/mount');",
    'frontend/src/monitor/dynamic.ts': "export const mount = () => import('../app/mount');",
    'frontend/src/app/mount.tsx': 'export const mount = () => {};',
  });
  assert.equal(rules(result).filter(rule => rule === 'app-ownership').length, 5);
  assert.equal(rules(result).filter(rule => rule === 'runtime-cycle').length, 1);
});

test('mixed type/value bindings still create runtime edges', t => {
  const result = fixture(t, {
    'frontend/src/exposure/a.ts': "import { type B, value } from './b'; export const a = value; export type A = B;",
    'frontend/src/exposure/b.ts': "export { a as value } from './a'; export type B = {};",
  });
  assert.deepEqual(rules(result), ['runtime-cycle']);
});

test('computed imports cannot silently bypass ownership checks', t => {
  const result = fixture(t, { 'frontend/src/exposure/a.ts': 'export const load = (name: string) => import(name);' });
  assert.deepEqual(rules(result), ['uncheckable-import']);
});

test('test fixtures/declarations are excluded and ordinary stylesheet imports still resolve', t => {
  const result = fixture(t, {
    'frontend/src/exposure/a.ts': "import './view.css'; export const a = 1;",
    'frontend/src/exposure/view.css': 'body {}',
    'frontend/src/exposure/b.test.ts': "import '../app/private';",
    'frontend/src/exposure/types.d.ts': "import '../app/private';",
  });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.files, ['frontend/src/exposure/a.ts']);
});

test('unresolved local modules are reported rather than omitted from enforcement', t => {
  const result = fixture(t, { 'frontend/src/exposure/a.ts': "import './missing';" });
  assert.deepEqual(rules(result), ['unresolved-import']);
});

test('Vite root-relative static, dynamic and re-export imports enforce app ownership', t => {
  const result = fixture(t, {
    'frontend/src/app/private.ts': 'export const value = 1;',
    'frontend/src/monitor/static.ts': "import { value } from '/src/app/private'; export { value };",
    'frontend/src/monitor/dynamic.ts': "export const load = () => import('/src/app/private.ts?raw');",
    'frontend/src/monitor/reexport.ts': "export { value } from '/src/app/private.ts';",
  });
  assert.equal(result.edges.length, 3);
  assert.deepEqual(rules(result), ['app-ownership', 'app-ownership', 'app-ownership']);
});

test('Vite root-relative type imports preserve approved model dependencies', t => {
  const result = fixture(t, {
    'frontend/src/exposure/model.ts': 'export type Row = {};',
    'frontend/src/monitor/model.ts': "export type { Row } from '/src/exposure/model';",
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.edges[0].to, 'frontend/src/exposure/model.ts');
  assert.equal(result.edges[0].typeOnly, true);
});

test('unresolved root-relative imports are reported as local imports', t => {
  const result = fixture(t, { 'frontend/src/monitor/model.ts': "export const load = () => import('/src/app/missing.ts');" });
  assert.deepEqual(rules(result), ['unresolved-import']);
});


test('existing Recovery, Monitor and common UI model allowances are type-only', t => {
  const result = fixture(t, {
    'frontend/src/exposure/model.ts': 'export const schema = {}; export type Row = {};',
    'frontend/src/recovery/allowed.ts': "export type { Row } from '../exposure/model';",
    'frontend/src/recovery/disallowed.ts': "import { schema } from '../exposure/model'; export { schema };",
    'frontend/src/monitor/disallowed.ts': "import { schema } from '../exposure/model'; export { schema };",
    'frontend/src/components/disallowed.ts': "export * as model from '../exposure/model';",
  });
  assert.equal(result.violations.length, 3);
  assert.ok(rules(result).every(rule => rule === 'feature-dependency'));
});

test('import-type queries still enforce dependency ownership', t => {
  const result = fixture(t, {
    'frontend/src/events/model.ts': "export type Bad = import('../recovery/model').Model;",
    'frontend/src/recovery/model.ts': 'export type Model = {};',
  });
  assert.deepEqual(rules(result), ['neutral-independence']);
  assert.equal(result.edges[0].typeOnly, true);
});
