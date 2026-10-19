import { test, expect } from '@playwright/test';
import { closeDialog, openFilters, openPortfolio } from '../helpers/exposure-workspace';

test('modes retain the earthquake, camera, map instance and exposure filters',async({page})=>{
 await page.goto('/exposure.html');
 await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).toHaveText('11');
 await openFilters(page);await page.getByRole('combobox',{name:'Show',exact:true}).selectOption('meeting');
 await page.getByRole('button',{name:'Close side panel',exact:true}).click();
 const map=page.getByTestId('exposure-map');await expect(map).toHaveAttribute('data-settled','true');
 const canvas=await page.locator('.maplibregl-canvas').elementHandle();
 const zoom=await map.getAttribute('data-camera-zoom');
 const title=await page.getByRole('heading',{level:1}).textContent();
 await page.getByRole('button',{name:'Recovery',exact:true}).click();
 await expect(page.getByRole('heading',{level:1})).toHaveText(title!);
 await expect(page.getByRole('button',{name:'Evaluate selected earthquake',exact:true})).toBeVisible();
 await expect(page.getByTestId('treaty-total')).toHaveCount(0);
 await expect(map).toHaveAttribute('data-camera-zoom',zoom!);
 expect(await canvas!.evaluate(element=>element.isConnected)).toBe(true);
 await page.getByRole('button',{name:'Evaluate selected earthquake',exact:true}).click();
 await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
 await expect(page.getByTestId('retained-evaluation')).toHaveCount(1);
 await page.getByRole('button',{name:'Exposure',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).toHaveText('11');
 await expect(page.getByRole('status').filter({hasText:'11 of 18 locations'})).toBeVisible();
 expect(await canvas!.evaluate(element=>element.isConnected)).toBe(true);
 await page.getByRole('button',{name:'Recovery',exact:true}).click();
 await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
 await expect(page.getByTestId('retained-evaluation')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
});

test('recovery changes invalidate exposure results until the selected observation is investigated',async({page})=>{
 await page.goto('/exposure.html');
 await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).toHaveText('11');
 await page.getByRole('button',{name:'Recovery',exact:true}).click();
 await page.getByRole('combobox',{name:'Demonstration scenario',exact:true}).selectOption('outer');
 await expect(page.getByTestId('treaty-total')).toHaveText('$3,750,000');
 await page.getByRole('button',{name:'Exposure',exact:true}).click();
 await expect(page.getByRole('heading',{level:1})).toContainText('outer');
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 await openPortfolio(page);await page.getByRole('button',{name:'Use 1,000 synthetic locations',exact:true}).click();await closeDialog(page);
 await expect(page.getByRole('heading',{level:1})).toContainText('outer');
 await page.getByRole('button',{name:'Investigate selected earthquake',exact:true}).click();
 await expect(page.getByTestId('exposure-unknown')).toHaveText('1000');
 await page.getByRole('button',{name:'Recovery',exact:true}).click();
 await expect(page.getByTestId('treaty-total')).toHaveText('$3,750,000');
});
