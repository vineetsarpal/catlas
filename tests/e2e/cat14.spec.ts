import {test,expect} from '@playwright/test';
test('select the synthetic outer observation and clear both modes safely',async({page})=>{
 await page.goto('/');
 await expect(page.getByTestId('treaty-total')).toHaveCount(0);
 await page.getByRole('button',{name:'Synthetic outer event · M7.1',exact:true}).click();
 await expect(page.getByTestId('treaty-total')).toHaveText('$3,750,000');
 await page.getByText('Inspect simulation provenance',{exact:true}).click();
 await expect(page.getByText('Inspect captured USGS evidence and provenance',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Clear event selection',exact:true}).click();
 await expect(page.getByTestId('treaty-total')).toHaveCount(0);
 await expect(page.getByRole('heading',{level:1})).toHaveText('Explore earthquake exposure');
 await page.getByRole('combobox',{name:'Demonstration scenario',exact:true}).selectOption('ridgecrest');
 await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
});
test('map presentation controls preserve recovery and area inspection',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Ridgecrest historical replay · M7.1',exact:true}).click();
 await expect(page.getByTestId('analytical-map')).toHaveAttribute('data-ready','true');
 await page.getByRole('button',{name:'World globe',exact:true}).click();
 await page.getByText('Layers & appearance',{exact:true}).click();
 await page.getByLabel('Treaty trigger zones',{exact:true}).uncheck();
 await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
 await page.getByLabel('Treaty trigger zones',{exact:true}).check();
 await page.getByText('Layers & appearance',{exact:true}).click();
 await page.getByRole('button',{name:'Regional',exact:true}).click();
 await page.getByRole('button',{name:'Western $1,500,000',exact:true}).click();
 await expect(page.getByRole('region',{name:'Western contribution explanation'})).toContainText('68.107 km');
 await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('map reference markers select the contractual area without changing the assessment',async({page})=>{
 await page.goto('/');await page.getByRole('combobox',{name:'Demonstration scenario',exact:true}).selectOption('ridgecrest');
 await expect(page.getByRole('button',{name:'Western fixed reference',exact:true})).toBeInViewport();
 await page.getByRole('button',{name:'Western fixed reference',exact:true}).click();
 await expect(page.getByRole('region',{name:'Western contribution explanation'})).toContainText('68.107 km');
 await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
});
