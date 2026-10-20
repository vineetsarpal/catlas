import { test, expect, type Page } from '@playwright/test';
async function open(page:Page){await page.goto('/');await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await expect(page.getByLabel('Search places or addresses')).toBeVisible();}
const payload={type:'FeatureCollection',features:Array.from({length:5},(_,i)=>({type:'Feature',geometry:{type:'Point',coordinates:[-79.38+i*.01,43.65]},properties:{name:`Toronto location ${i+1}`,street:'A very long street name that wraps across multiple lines',housenumber:String(100+i),city:'Toronto',state:'Ontario',country:'Canada'}}))};
test('suggestions appear after typing and each result contains its full address without overlap',async({page},info)=>{
 await page.route('https://photon.komoot.io/api/**',route=>route.fulfill({json:payload}));await open(page);
 await page.getByLabel('Search places or addresses').fill('Toronto');
 await expect(page.getByRole('listbox',{name:'Place suggestions'})).toBeVisible();
 const options=page.getByRole('listbox',{name:'Place suggestions'}).getByRole('option');await expect(options).toHaveCount(5);
 const layout=await options.evaluateAll(elements=>elements.map(el=>{const box=el.getBoundingClientRect(),text=el.querySelector('.place-option-address')!.getBoundingClientRect();return {top:box.top,bottom:box.bottom,textBottom:text.bottom,height:box.height};}));
 expect(layout.every(row=>row.height>=60&&row.textBottom<=row.bottom)).toBe(true);
 expect(layout.slice(1).every((row,i)=>row.top>=layout[i].bottom-1)).toBe(true);
 await page.screenshot({path:`test-results/place-suggestions-${info.project.name}.png`});
});
test('existing submitted results never shrink below their address text',async({page})=>{
 await page.route('https://photon.komoot.io/api/**',route=>route.fulfill({json:payload}));await open(page);await page.getByLabel('Search places or addresses').fill('Toronto');await page.getByRole('button',{name:'Search places',exact:true}).click();
 await expect(page.locator('.portfolio-place-results button')).toHaveCount(5);
 expect(await page.locator('.portfolio-place-results button').evaluateAll(elements=>elements.every(el=>{const children=Array.from(el.querySelectorAll('strong,span'));return children.every(child=>child.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom);}))).toBe(true);
});

test('keyboard navigation selects a suggestion and Escape closes the list',async({page})=>{
 await page.route('https://photon.komoot.io/api/**',route=>route.fulfill({json:payload}));await open(page);
 const input=page.getByLabel('Search places or addresses');await input.fill('Toronto');await expect(page.getByRole('listbox',{name:'Place suggestions'})).toBeVisible();
 await input.press('Escape');await expect(page.getByRole('listbox',{name:'Place suggestions'})).toHaveCount(0);
 await input.press('ArrowDown');await input.press('ArrowDown');await input.press('Enter');
 await expect(page.getByRole('heading',{name:'Toronto location 2',exact:true})).toBeVisible();
 await expect(page.locator('#portfolio-location-table tbody tr')).toHaveCount(18);
});

test('a changed query cancels stale suggestions and only displays the latest results',async({page})=>{
 const queries:string[]=[];
 await page.route('https://photon.komoot.io/api/**',async route=>{const q=new URL(route.request().url()).searchParams.get('q')!;queries.push(q);if(q==='Toronto')await new Promise(resolve=>setTimeout(resolve,700));await route.fulfill({json:{type:'FeatureCollection',features:[{...payload.features[0],properties:{name:q,city:'Example city'}}]}}).catch(()=>{});});
 await open(page);const input=page.getByLabel('Search places or addresses');await input.fill('Toronto');await expect.poll(()=>queries.length).toBe(1);
 await input.fill('Montreal');await expect(page.getByRole('option',{name:'Montreal Example city',exact:true})).toBeVisible();
 await expect(page.getByRole('listbox',{name:'Place suggestions'})).not.toContainText('Toronto');expect(queries).toEqual(['Toronto','Montreal']);
});
