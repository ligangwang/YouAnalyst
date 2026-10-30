import {test,expect} from '@playwright/test';
import {calendarFixtureHtml,calendarFixtures,fixtureDay} from './fixtures/calendar';
import {shiftDay,visibleDays} from '../../src/lib/calendar/display';

let html:string;
test.beforeAll(async()=>{html=await calendarFixtureHtml();});

for(const chinese of [false,true])test(`JBL quarter and full-year aliases show one card and one call (${chinese?'Chinese':'English'})`,async({page},info)=>{
  const now=new Date('2026-09-29T12:00:00Z');await page.clock.install({time:now});await page.clock.pauseAt(now);
  const call={...calendarFixtures[0],id:'jbl-q4-call',companyId:'US:JBL',ticker:'JBL',companyName:'Jabil',companyNames:{en:'Jabil','zh-CN':'捷普'},
    scheduled_date:'2026-09-30',scheduled_at:'2026-09-30T12:30:00Z',local_time:'08:30',timezone_text:'ET',fiscalPeriod:'FY2026-Q4',processed_at:'2026-10-13T21:07:00Z'};
  const events=[call,{...call,id:'jbl-annual-call',fiscalPeriod:'FY2026',processed_at:'2026-10-16T21:05:00Z'},
    {...call,id:'jbl-release',eventKind:'earnings_release',scheduled_at:null,local_time:null,source_timezone:null,timezone_text:null,time_precision:'date',timeSlot:'before_market'}];
  await page.route('http://calendar.test/**',route=>{
    const url=new URL(route.request().url());
    return url.pathname==='/api/calendar'?route.fulfill({json:{events,total:3,truncated:false,from:url.searchParams.get('from'),to:url.searchParams.get('to'),lastCollectedAt:null,collectionStatus:'complete'}}):route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(`http://calendar.test/?date=2026-09-30&event=jbl-annual-call${chinese?'&lang=zh-CN':''}`);await page.clock.runFor(0);
  const agenda=page.getByRole('complementary',{name:chinese?'所选日期日程':'Selected day agenda'});
  const card=agenda.getByRole('article');await expect(card).toHaveCount(1);
  await expect(card).toHaveClass(/linkedEvent/);
  await expect(card).toContainText(chinese?'财报与电话会':'Results & call');
  await expect(card).toContainText('FY2026-Q4 / FY2026');
  await expect(card.getByText(/8:30/)).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText(chinese?'1 项活动':'1 scheduled events in view');
  await page.getByRole('button',{name:chinese?'周视图':'Week',exact:true}).click();
  const calendar=page.getByRole('region',{name:chinese?'财报日历':'Earnings calendar'});
  await expect(calendar.getByRole('article')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('jbl-deduplicated.png'),fullPage:true});
});

for(const chinese of [false,true])test(`calendar countdowns tick without network reads and use Beijing for omitted Chinese zones (${chinese?'Chinese':'English'})`,async({page},info)=>{
  const now=new Date('2026-11-17T12:00:00Z');
  await page.clock.install({time:now});await page.clock.pauseAt(now);
  const base={...calendarFixtures[0],scheduled_date:'2026-11-17',scheduled_at:null,local_time:null,source_timezone:null,timezone_text:null,time_precision:'date' as const};
  const events=[
    {...base,id:'cn-local',companyId:'XSHG:600000',ticker:'600000',companyName:'Example China',scheduled_date:'2026-11-18',local_time:'09:00',time_precision:'local'},
    {...base,id:'date-only',companyId:'US:DATE',ticker:'DATE',eventKind:'earnings_release',timeSlot:'after_market'},
    {...base,id:'cancelled',companyId:'US:STOP',ticker:'STOP',scheduled_at:'2026-11-17T14:00:00Z',status:'cancelled'},
    {...base,id:'explicit-zone',companyId:'US:EXPLICIT',companyCountry:'CN',ticker:'EXPLICIT',scheduled_at:'2026-11-17T15:00:00Z',local_time:'10:00',source_timezone:'America/New_York',timezone_text:'ET',time_precision:'exact'},
    {...base,id:'unknown-zone',companyId:'US:UNKNOWN',ticker:'UNKNOWN',local_time:'10:00',time_precision:'local'},
    {...base,id:'cn-us-local',companyId:'US:CNUS',companyCountry:'CN',ticker:'CNUS',scheduled_date:'2026-11-18',local_time:'09:00',time_precision:'local'},
    {...base,id:'cn-date',companyId:'US:CNDATE',companyCountry:'CN',ticker:'CNDATE',eventKind:'earnings_release'},
  ];
  let requests=0;
  await page.route('http://calendar.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/calendar'){requests++;return route.fulfill({json:{events,total:events.length,truncated:false,from:url.searchParams.get('from'),to:url.searchParams.get('to'),lastCollectedAt:null,collectionStatus:'complete'}});}
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(`http://calendar.test/?date=2026-11-17${chinese?'&lang=zh-CN':''}`);
  await page.clock.runFor(0);
  const agenda=page.getByRole('complementary',{name:chinese?'所选日期日程':'Selected day agenda'});
  const cn=agenda.getByRole('article').filter({hasText:'600000'});
  await expect(cn).toContainText(chinese?'20:00 ET（原时间默认按北京时间）':'8:00 PM ET (source time assumed Beijing)');
  await expect(cn).toContainText(chinese?'倒计时 13:00:00':'Starts in 13:00:00');
  await page.clock.runFor(1000);
  await expect(cn).toContainText(chinese?'倒计时 12:59:59':'Starts in 12:59:59');
  await expect(agenda.getByRole('article').filter({has:page.getByText('DATE',{exact:true})})).toContainText(chinese?'今天 · 时刻未公布':'Today · time TBD');
  await expect(agenda.getByRole('article').filter({hasText:'STOP'})).not.toContainText(chinese?'倒计时':'Starts in');
  const explicit=agenda.getByRole('article').filter({hasText:'EXPLICIT'});
  await expect(explicit).toContainText(chinese?'10:00 ET':'10:00 AM ET');
  await expect(explicit).not.toContainText(chinese?'默认按北京时间':'assumed Beijing');
  await expect(agenda.getByRole('article').filter({hasText:'UNKNOWN'})).toContainText(chinese?'倒计时待确认':'Countdown pending');
  await expect(agenda.getByRole('article').filter({hasText:'CNUS'})).toContainText(chinese?'原时间默认按北京时间':'source time assumed Beijing');
  await expect(agenda.getByRole('article').filter({hasText:'CNDATE'})).toContainText(chinese?'今天 · 时刻未公布（按北京时间日期）':'Today · time TBD (Beijing date)');
  expect(requests).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('earnings-countdown.png'),fullPage:true});
  await page.clock.fastForward(13*3600*1000);
  await expect(cn).toContainText(chinese?'已到公告时间':'Scheduled time reached');
  expect(requests).toBe(1);
});
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
  await page.getByRole('button',{name:'Next period',exact:true}).click();
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
  const history=page.getByRole('button',{name:'Browse dates & history'});if(await history.isVisible())await history.click();
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
  await expect(agenda.getByRole('article').filter({hasText:'NVDA'}).getByRole('link',{name:'Company →'})).toHaveAttribute('href','/en/company/nvidia');
  await expect(agenda.getByRole('article').filter({hasText:'600000'}).getByRole('link',{name:'Company →'})).toHaveAttribute('href','/en/company/%E6%B5%A6%E5%8F%91%E9%93%B6%E8%A1%8C');
  await page.getByRole('checkbox',{name:'Watchlist only'}).check();
  await expect(agenda.getByRole('article')).toHaveCount(2);
  await expect(agenda).toContainText('600000');
  await page.getByRole('checkbox',{name:'Watchlist only'}).uncheck();
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
  fail=true;await page.getByRole('button',{name:'Next period',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Schedules could not be refreshed.');
  await expect(page.getByRole('heading',{name:'Earnings calendar',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
});

test('mobile calendar defaults to upcoming and makes history optional',async({page},info)=>{
 const now=new Date('2026-11-17T12:00:00Z');await page.clock.install({time:now});
 await page.route('http://calendar.test/**',route=>{const url=new URL(route.request().url());return url.pathname==='/api/calendar'?route.fulfill({json:{events:[],total:0,truncated:false,from:url.searchParams.get('from'),to:url.searchParams.get('to'),collectionStatus:'complete'}}):route.fulfill({contentType:'text/html',body:html});});
 await page.goto('http://calendar.test/');
 const toggle=page.getByRole('button',{name:'Browse dates & history'});
 const grid=page.getByRole('region',{name:'Earnings calendar',exact:true});
 if(info.project.name==='desktop'){await expect(toggle).toBeHidden();await expect(grid).toBeVisible();return;}
 await expect(toggle).toBeVisible();await expect(grid).toBeHidden();await toggle.click();await expect(grid).toBeVisible();
});
