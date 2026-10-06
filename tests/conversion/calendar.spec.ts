import {test,expect} from '@playwright/test';
import {calendarFixtureHtml,calendarFixtures,fixtureDay} from './fixtures/calendar';

let html:string;
test.beforeAll(async()=>{html=await calendarFixtureHtml();});
test('month and week handle crowded dates, theme overlap, source links and a failed refresh without losing the page',async({page})=>{
  // Start in another week of the same month so switching views must follow the selected day.
  const fixtureDate=new Date(`${fixtureDay}T16:00:00Z`);
  const clockDay=new Date(Date.UTC(fixtureDate.getUTCFullYear(),fixtureDate.getUTCMonth()+(fixtureDate.getUTCDate()<=14?1:0),fixtureDate.getUTCDate()<=14?0:1,16));
  await page.clock.install({time:clockDay});
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});
  let fail=false;
  await page.route('http://calendar.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/map-follows')return route.fulfill({json:{companyIds:['US:NVDA','XSHG:600000']}});
    if(url.pathname==='/api/calendar'){
      if(fail)return route.fulfill({status:503,json:{error:'Unavailable'}});
      return route.fulfill({json:{events:calendarFixtures,total:8,truncated:false,from:url.searchParams.get('from'),to:url.searchParams.get('to'),lastCollectedAt:null,collectionStatus:'collecting'}});
    }
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto('http://calendar.test/');
  await expect(page.getByRole('status')).toHaveText('8 scheduled events in view');
  const selectedDayLabel=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(fixtureDate);
  await page.getByRole('button',{name:selectedDayLabel,exact:true}).click();
  const agenda=page.getByRole('complementary',{name:'Selected day agenda'});
  await expect(agenda.getByRole('article')).toHaveCount(8);
  await expect(page.getByRole('button',{name:'+6 more'})).toBeVisible();
  await expect(agenda.getByRole('link',{name:'Source ↗'}).first()).toHaveAttribute('href','https://example.com/earnings');
  await expect(agenda.getByRole('article').filter({hasText:'NVDA'}).getByRole('link',{name:'Company →'})).toHaveAttribute('href','/en/ticker/NVDA');
  await expect(agenda.getByRole('article').filter({hasText:'600000'}).getByRole('link',{name:'Company →'})).toHaveAttribute('href','/en/ticker/XSHG:600000');
  await page.getByRole('checkbox',{name:'Following only'}).check();
  await expect(agenda.getByRole('article')).toHaveCount(2);
  await expect(agenda).toContainText('600000');
  await page.getByRole('checkbox',{name:'Following only'}).uncheck();
  await page.getByRole('combobox',{name:'Theme'}).selectOption('robotics');
  await expect(agenda.getByRole('article')).toHaveCount(1);await expect(agenda).toContainText('NVDA');
  await page.getByRole('combobox',{name:'Theme'}).selectOption('space');
  await expect(agenda).toContainText('Time not announced');
  await page.getByRole('combobox',{name:'Theme'}).selectOption('all');
  await page.getByRole('button',{name:'Week',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('8 scheduled events in view');
  await expect(page.getByRole('button',{name:selectedDayLabel,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'+4 more'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  fail=true;await page.getByRole('button',{name:'Next period'}).click();
  await expect(page.getByRole('status')).toContainText('Schedules could not be refreshed.');
  await expect(page.getByRole('heading',{name:'Earnings calendar',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
});
