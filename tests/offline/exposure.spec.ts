import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { openHistory, openLocations, openPortfolio } from '../helpers/exposure-workspace';
import { gunzipSync } from 'node:zlib';
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin==='http://127.0.0.1:4178'&&!url.pathname.startsWith('/src/')?route.continue():route.abort();});
 await page.goto('/exposure.html');
});
test('extracted exposure build reproduces replay, supported portfolio and frozen case roundtrip without external requests',async({page,browser},info)=>{
 await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('11',{timeout:30000});
 await expect(page.getByTestId('exposure-unknown')).toHaveText('2');await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-ready','true');
 await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-shaking-ready','true');await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-land-rendered','true');
 await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-boundary-features',/^[1-9][0-9]*$/);
 await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-geographic-labels',/[A-Za-z]/);
 await openHistory(page);await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.getByRole('button',{name:'Saved in this browser',exact:true})).toBeDisabled();
 await openLocations(page);const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();const bytes=await fs.readFile((await (await pending).path())!);const bundle=JSON.parse(gunzipSync(bytes).toString());
 expect(bundle.record.summary.meetingThreshold).toBe(11);expect(bundle.rawEventJson).toContain('ci38457511');
 await openPortfolio(page);await page.getByText('Demo portfolios',{exact:true}).click();await page.getByRole('button',{name:'Use 1,000 synthetic locations',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.getByRole('button',{name:'Investigate latest portfolio',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('590');
 await page.reload();await openHistory(page);await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('11');
 await page.screenshot({path:`offline-test-results/exposure-${info.project.name}.png`,fullPage:true});
 const context=await browser.newContext({viewport:{width:375,height:812}}),fresh=await context.newPage();
 await fresh.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4178'?route.continue():route.abort());await fresh.goto('http://127.0.0.1:4178/exposure.html');
 await openHistory(fresh);await fresh.getByLabel('Open a self-contained case').setInputFiles({name:'case.json.gz',mimeType:'application/gzip',buffer:bytes});await expect(fresh.getByTestId('exposure-count')).toHaveText('11');await expect(fresh.locator('.exposure-history li')).toHaveCount(1);
 expect(await fresh.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await context.close();
});
