import { expect, test, type Locator, type Page } from '@playwright/test';

async function noViewportOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
}

async function orderedPanels(left: Locator, map: Locator, right: Locator) {
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect.poll(async () => {
    const [a, b, c] = await Promise.all([left.boundingBox(), map.boundingBox(), right.boundingBox()]);
    return Boolean(a && b && c && a.x + a.width <= b.x + 1 && b.x + b.width <= c.x + 1 && b.width > 100);
  }).toBe(true);
}

async function demoPortfolio(page: Page) {
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await expect(page.getByLabel('Portfolio inventory summary')).toContainText('18');
}

test('monitor keeps options left and selected location details right, preserving layer preferences', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('catlas-monitor-1', JSON.stringify({ earthquakes: false, cyclones: false, wind: false, vessels: false, locations: true, fires: false, perimeters: false, alerts: false, nearPortfolio: false, watchedOnly: false, watchlist: [] })));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await demoPortfolio(page);
  await page.getByRole('button', { name: 'Monitor', exact: true }).click();
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  const left = page.locator('#atlas-monitor-panel');
  await left.getByRole('button', { name: 'Ridgecrest medical centre', exact: true }).click();
  const right = page.getByRole('complementary', { name: 'Selected monitoring item' });
  await expect(right).toContainText('Ridgecrest medical centre');
  if (info.project.name === 'desktop') {
    await orderedPanels(left, page.locator('.is-monitor .atlas-map-stage'), right);
  } else {
    await expect(left).not.toBeVisible();
  }
  await noViewportOverflow(page);
  await page.screenshot({ path: `docs.local/verification/workspace-sidebars-monitor-${info.project.name}.png` });
  if(info.project.name==='desktop'){
    await page.setViewportSize({width:375,height:812});
    await expect(left).not.toBeVisible();await expect(right).toBeVisible();await noViewportOverflow(page);
    await page.setViewportSize({width:1280,height:720});
  }
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  const locations = page.getByRole('switch', { name: 'Insured locations', exact: true });
  await locations.uncheck();
  await page.getByRole('button', { name: 'Attention', exact: true }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(locations).not.toBeChecked();
  if (info.project.name === 'mobile') await expect(right).not.toBeVisible();
  await noViewportOverflow(page);
});

test('portfolio options stay left while selected location details and editing stay right', async ({ page }, info) => {
  await demoPortfolio(page);
  await page.getByRole('button', { name: /Show locations/ }).click();
  await page.locator('#portfolio-location-table').getByRole('button', { name: 'Ridgecrest medical centre', exact: true }).click();
  const right = page.getByRole('complementary', { name: 'Portfolio location details' });
  await expect(right).toContainText('Ridgecrest medical centre');
  const left = page.getByRole('complementary', { name: 'Portfolio options', exact: true });
  if (info.project.name === 'desktop') await orderedPanels(left, page.locator('.portfolio-work-area .atlas-map-stage'), right);
  else await expect(left).not.toBeVisible();
  await noViewportOverflow(page);
  await right.getByRole('button', { name: 'Edit location', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit location', exact: true });
  await expect(form).toBeVisible();
  await expect(right.getByRole('heading',{name:'Edit location',exact:true})).toHaveCount(1);
  await expect(right).toBeVisible();
  if (info.project.name === 'mobile') await expect(left).not.toBeVisible();
  await expect(form.getByLabel('Location name', { exact: true })).toHaveValue('Ridgecrest medical centre');
  await noViewportOverflow(page);
});


test('recovery separates assessment options from selected contractual details', async ({ page }, info) => {
  await page.goto('/?mode=recovery&recovery=parametric');
  const left = page.locator('#atlas-recovery-panel');
  const right = page.locator('#atlas-recovery-inspector');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Assessment', exact: true }).first().click();
  const scenario = page.getByRole('combobox', { name: 'Demonstration scenario', exact: true });
  await scenario.selectOption('ridgecrest');
  await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
  if (info.project.name === 'desktop') await orderedPanels(left, page.locator('.is-recovery .atlas-map-stage'), right);
  else {
    if (!await right.isVisible()) await page.getByRole('navigation', { name: 'Recovery tools', exact: true }).getByRole('button', { name: 'Recovery details', exact: true }).click();
    await expect(right).toBeVisible();
    await expect(left).not.toBeVisible();
  }
  await right.getByRole('button', { name: /^Western/ }).click();
  const explanation = right.getByRole('region', { name: 'Western contribution explanation', exact: true });
  await expect(explanation).toBeVisible();
  await explanation.scrollIntoViewIfNeeded();
  await noViewportOverflow(page);
  await page.screenshot({ path: `docs.local/verification/workspace-sidebars-recovery-${info.project.name}.png` });
});

test('event-loss recovery preserves draft inputs across tabs and reviews the result on the right', async ({ page }, info) => {
  await page.goto('/?mode=recovery');
  const tools=page.getByRole('navigation',{name:'Recovery tools',exact:true});
  const assessment=tools.getByRole('button',{name:'Assessment',exact:true});
  if(await assessment.getAttribute('aria-expanded')!=='true')await assessment.click();
  const left=page.locator('#atlas-recovery-panel'),right=page.locator('#atlas-recovery-inspector');
  await left.getByRole('button',{name:'Use Ridgecrest earthquake',exact:true}).click();
  await left.getByLabel('Insurer / legal entity',{exact:true}).fill('Draft insurer');
  await expect(left.getByRole('heading',{level:2})).toHaveText(['Recovery assessment']);
  await tools.getByRole('button',{name:'History',exact:true}).click();
  await expect(left.getByRole('heading')).toHaveText(['Recovery history']);
  await expect(left.getByText('Assess one catastrophe excess-of-loss layer', { exact:false })).toBeHidden();
  await assessment.click();
  await expect(left.getByLabel('Insurer / legal entity',{exact:true})).toHaveValue('Draft insurer');
  const inputs:Record<string,string>={
    'Business line / covered portfolio':'Property','Loss estimate source / reference':'Loss estimate 1','Loss valuation date':'2019-07-06',
    'Estimated eligible event loss':'10000000','Contract reference / version':'Layer v1','First covered date (UTC)':'2019-01-01',
    'Last covered date (UTC, inclusive)':'2019-12-31','Retention / attachment':'2000000','Layer limit at 100%':'5000000',
    'Remaining available limit at 100%':'5000000','Placed share (%)':'100',
  };
  for(const [label,value] of Object.entries(inputs))await left.getByLabel(label,{exact:true}).fill(value);
  await left.getByRole('checkbox',{name:/I checked covered business/}).check();
  await left.getByRole('button',{name:'Calculate provisional recovery',exact:true}).click();
  await expect(right).toBeVisible();
  await expect(right.getByTestId('simple-recovery-total')).toHaveText('$5,000,000.00');
  if(info.project.name==='mobile')await expect(left).not.toBeVisible();
  await right.getByLabel('Review notes',{exact:true}).fill('Reviewed inputs and explanation.');
  await right.getByRole('checkbox',{name:'I reviewed the inputs and calculation for this assessment.',exact:true}).check();
  await right.getByRole('button',{name:'Save reviewed version',exact:true}).click();
  await expect(right.getByRole('button',{name:'Download reviewed assessment',exact:true})).toBeVisible();
  await tools.getByRole('button',{name:'History',exact:true}).click();
  await expect(left.getByRole('button',{name:'Open reviewed version 1',exact:true})).toBeVisible();
  await noViewportOverflow(page);
});

test('every module keeps layer controls in the left sidebar and retains toggles across tabs', async ({ page }, info) => {
  await demoPortfolio(page);
  const layersButton=()=>page.getByRole('button',{name:'Layers',exact:true});
  async function layersOnLeft() {
    await layersButton().click();
    const controls=page.locator('.exposure-map-layers[aria-label="Map layers"]');
    await expect(controls).toBeVisible();
    await expect(page.locator('.exposure-map-menus summary').filter({hasText:/^Layers$/})).toHaveCount(0);
    expect(await controls.evaluate(node=>Boolean(node.closest('aside')))).toBe(true);
    await noViewportOverflow(page);
    return controls;
  }
  let controls=await layersOnLeft();
  await controls.getByLabel('Insured locations',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Your portfolios',exact:true}).click();
  controls=await layersOnLeft();
  await expect(controls.getByLabel('Insured locations',{exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
  controls=await layersOnLeft();
  await controls.getByLabel('Shaking layer',{exact:true}).uncheck();
  await layersButton().click();
  controls=await layersOnLeft();
  await expect(controls.getByLabel('Shaking layer',{exact:true})).not.toBeChecked();
  await page.screenshot({path:`docs.local/verification/layers-sidebar-exposure-${info.project.name}.png`});
  await page.goto('/?mode=recovery&recovery=parametric');
  controls=await layersOnLeft();
  await controls.getByLabel('Treaty trigger zones',{exact:true}).uncheck();
  await page.getByRole('navigation',{name:'Recovery tools',exact:true}).getByRole('button',{name:'Assessment',exact:true}).click();
  controls=await layersOnLeft();
  await expect(controls.getByLabel('Treaty trigger zones',{exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'Monitor',exact:true}).click();
  await layersButton().click();
  await expect(page.getByRole('switch',{name:'Insured locations',exact:true})).toBeVisible();
  await expect(page.locator('.exposure-map-menus summary').filter({hasText:/^Layers$/})).toHaveCount(0);
  await noViewportOverflow(page);
});

test('sidebar titles identify one task without repeating content introductions',async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('catlas-monitor-1',JSON.stringify({earthquakes:false,cyclones:false,wind:false,vessels:false,locations:true,fires:false,perimeters:false,alerts:false,nearPortfolio:false,watchedOnly:false,watchlist:[]})));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await demoPortfolio(page);
  const portfolioTools=page.getByRole('navigation',{name:'Portfolio tools',exact:true});
  await portfolioTools.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'Portfolio options',exact:true}).getByRole('heading')).toHaveText(['Portfolio settings']);
  await page.getByRole('button',{name:'Monitor',exact:true}).click();
  await page.getByRole('navigation',{name:'Monitor tools',exact:true}).getByRole('button',{name:'Feeds',exact:true}).click();
  await expect(page.locator('#atlas-monitor-panel').getByRole('heading',{level:2})).toHaveText(['Feed status']);
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
  await page.getByRole('button',{name:'Explore regions',exact:true}).click();
  await expect(page.locator('#atlas-side-panel').getByRole('heading')).toHaveText(['Regional exposure']);
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const recoveryTools=page.getByRole('navigation',{name:'Recovery tools',exact:true});
  await recoveryTools.getByRole('button',{name:'History',exact:true}).click();
  await expect(page.locator('#atlas-recovery-panel').getByRole('heading')).toHaveText(['Recovery history']);
  await noViewportOverflow(page);
});
