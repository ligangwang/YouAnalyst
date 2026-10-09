import {test,expect} from '@playwright/test';
import {calendarFixtureHtml,calendarFixtures,fixtureDay} from './fixtures/calendar';
import {shiftDay,visibleDays} from '../../src/lib/calendar/display';

let html:string;
test.beforeAll(async()=>{html=await calendarFixtureHtml();});
test('server calendar snapshot avoids a duplicate read and range changes still refresh',async({page})=>{
  const days=visibleDays(fixtureDay,'month');
  const body=await calendarFixtureHtml({events:calendarFixtures,total:calendarFixtures.length,truncated:false,from:days[0],to:days.at(-1)!,lastCollectedAt:null,collectionStatus:'collecting'});
  let requests=0;
  await page.route('http://calendar.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/calendar'){requests++;return route.fulfill({json:{events:[],total:0,truncated:false,from:url.searchParams.get('from'),to:url.searchParams.get('to'),lastCollectedAt:null,collectionStatus:'complete'}});}
    return route.fulfill({contentType:'text/html',body});
  });
  await page.goto(`http://calendar.test/?date=${fixtureDay}`);
  await expect(page.getByRole('status')).toHaveText('8 scheduled events in view');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(null)))));
  expect(requests).toBe(0);
  await page.getByRole('button',{name:'Next period'}).click();
  await expect(page.getByRole('status')).toHaveText('0 scheduled events in view');
  expect(requests).toBe(1);
});

test('unavailable calendar data does not claim a known collection status',async({page})=>{
  await page.route('http://calendar.test/**',route=>new URL(route.request().url()).pathname==='/api/calendar'?route.fulfill({status:503,json:{error:'Unavailable'}}):route.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://calendar.test/');
  await expect(page.getByRole('status')).toContainText('Schedules could not be refreshed.');
  await expect(page.getByText('Collection is in progress; this calendar includes announced dates and does not yet cover every company.',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Schedule collection is starting; announced dates will appear as sources are processed.',{exact:true})).toHaveCount(0);
});
test('a news calendar link opens the specified day and company in the agenda',async({page})=>{
  const day='2026-11-03';
  const linked={...calendarFixtures[0],scheduled_date:day,scheduled_at:`${day}T21:00:00Z`,confirmation:'extracted',validationWarnings:['Market session is not established by the source']};
  await page.route('http://calendar.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/calendar')return route.fulfill({json:{events:[linked],total:1,truncated:false,from:url.searchParams.get('from'),to:url.searchParams.get('to'),lastCollectedAt:null,collectionStatus:'complete'}});
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(`http://calendar.test/?date=${day}&company=US%3ANVDA&event=${linked.id}`);
  await expect(page.getByRole('heading',{name:'November 2026'})).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('NVDA');
  const agenda=page.getByRole('complementary',{name:'Selected day agenda'});
  await expect(agenda.getByRole('heading',{name:'Tuesday, Nov 3'})).toBeVisible();
  await expect(agenda.getByRole('article')).toContainText('NVDA');
  await expect(agenda.getByRole('article')).toHaveClass(/linkedEvent/);
  await expect(agenda.getByText('⚠ Validation warning')).toBeVisible();
  await expect(agenda.getByText('AI extracted',{exact:true})).toBeVisible();
  await agenda.getByText('View validation warning',{exact:true}).click();
  await expect(agenda.getByText('Market session is not established by the source',{exact:true})).toBeVisible();
});
test('month and week handle crowded dates, theme overlap, source links and a failed refresh without losing the page',async({page})=>{
  // Start in another week of the same month so switching views must follow the selected day.
  const fixtureDate=new Date(`${fixtureDay}T16:00:00Z`);
  const clockDay=new Date(Date.UTC(fixtureDate.getUTCFullYear(),fixtureDate.getUTCMonth()+(fixtureDate.getUTCDate()<=14?1:0),fixtureDate.getUTCDate()<=14?0:1,16));
  await page.clock.install({time:clockDay});
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});
  let fail=false,relatedDates=false;
  const otherDay=shiftDay(fixtureDay,fixtureDate.getUTCDay()===0?-1:1);
  const relatedFixtures=[
    {...calendarFixtures[0],id:'nvda_prior_period',fiscalPeriod:'FY2026-Q2'},
    {...calendarFixtures[0],id:'nvda_other_day',scheduled_date:otherDay,scheduled_at:`${otherDay}T17:00:00Z`},
  ];
  await page.route('http://calendar.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/map-follows')return route.fulfill({json:{companyIds:['US:NVDA','XSHG:600000']}});
    if(url.pathname==='/api/calendar'){
      if(fail)return route.fulfill({status:503,json:{error:'Unavailable'}});
      const events=relatedDates?[...calendarFixtures,...relatedFixtures]:calendarFixtures;
      return route.fulfill({json:{events,total:events.length,truncated:false,from:url.searchParams.get('from'),to:url.searchParams.get('to'),lastCollectedAt:null,collectionStatus:'collecting'}});
    }
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto('http://calendar.test/');
  await expect(page.getByRole('status')).toHaveText('8 scheduled events in view');
  const selectedDayLabel=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(fixtureDate);
  await page.getByRole('button',{name:selectedDayLabel,exact:true}).click();
  const agenda=page.getByRole('complementary',{name:'Selected day agenda'});
  await expect(agenda.getByRole('article')).toHaveCount(8);
  const nvda=agenda.getByRole('article').filter({hasText:'NVDA'});
  await expect(nvda).toHaveCount(1);
  await expect(nvda).toContainText('Results & call');
  await expect(nvda).toContainText('Results: After market close');
  const callTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(calendarFixtures[0].scheduled_at!));
  await expect(nvda).toContainText(`Call: ${callTime} ET`);
  await expect(nvda.getByRole('link',{name:'Source ↗',exact:true})).toHaveCount(1);
  const test2=agenda.getByRole('article').filter({hasText:'TEST2'});
  await expect(test2).toContainText('Cancelled');
  await expect(test2).toContainText('Rescheduled');
  await expect(test2.getByRole('link',{name:'Call source ↗',exact:true})).toHaveAttribute('href','https://example.com/earnings');
  await expect(test2.getByRole('link',{name:'Results source ↗',exact:true})).toHaveAttribute('href','https://example.com/results');
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
  relatedDates=true;
  await page.getByRole('button',{name:'Month',exact:true}).click();
  await expect(agenda.getByRole('article')).toHaveCount(9);
  await expect(agenda.getByRole('article').filter({hasText:'NVDA'})).toHaveCount(2);
  await expect(agenda).toContainText('FY2026-Q2');
  const otherDayLabel=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${otherDay}T16:00:00Z`));
  await page.getByRole('button',{name:otherDayLabel,exact:true}).click();
  await expect(agenda.getByRole('article')).toHaveCount(1);
  await expect(agenda).toContainText('Earnings call');
  await expect(agenda).not.toContainText('Results & call');
  await page.getByRole('button',{name:'Week',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('10 scheduled events in view');
  fail=true;await page.getByRole('button',{name:'Next period'}).click();
  await expect(page.getByRole('status')).toContainText('Schedules could not be refreshed.');
  await expect(page.getByRole('heading',{name:'Earnings calendar',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
});
