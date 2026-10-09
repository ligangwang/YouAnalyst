import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let html: string;
test.beforeAll(async()=>{
 const bundle=await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {AnalystProfilePage} from "./src/components/analyst-profile-page";import {LocaleProvider} from "./src/components/providers/locale-provider";createRoot(document.getElementById("root")).render(<LocaleProvider locale="en"><AnalystProfilePage userId="analyst"/></LocaleProvider>);`,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,outfile:"profile.js",platform:"browser",define:{"process.env.NODE_ENV":'"test"'},alias:{"next/link":path.resolve("tests/industry/link.tsx")},plugins:[{name:"profile-fixture",setup(b){
 b.onResolve({filter:/auth-provider$/},()=>({path:path.resolve("tests/conversion/fixtures/mocks.tsx")}));
 b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"fixture"}));
 b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react'; export default function Image(props){return <img {...props}/>}",loader:"jsx",resolveDir:process.cwd()}));
 }}]});
 html=`<html><body><div id="root"></div><script>${bundle.outputFiles.find(f=>f.path.endsWith(".js"))!.text.replaceAll("</script","<\\/script")}</script></body></html>`;
});
test("profile watchlists upgrade from preview to full and clear full rows on sign-out",async({page})=>{
 const metrics={livePredictionCount:9,settledPredictionCount:0,liveReturn:0.1,settledReturn:null};
 const watchlist={id:"list",userId:"analyst",name:"Test watchlist",metrics};
 const stats=Object.fromEntries(["totalPredictions","openingPredictions","openPredictions","closingPredictions","closedPredictions","canceledPredictions","totalScore","settledCalls","totalXP","level","followersCount","followingCount"].map(k=>[k,0]));
 const calls=Array.from({length:9},(_,i)=>({id:`call-${i}`,ticker:`Q${i}`,direction:"UP",thesis:"",createdAt:"2026-09-01T00:00:00Z",status:"OPEN",entryPrice:10,entryDate:"2026-09-01",commentCount:0,result:null}));
 const authHeaders:(string|undefined)[]=[];
 const recordAuth:(string|undefined)[]=[];
 await page.route("**/*",r=>{
  const url=r.request().url();
  if(url.includes("/api/users/analyst/track-record")){recordAuth.push(r.request().headers().authorization);return r.fulfill({json:{benchmark:"QQQ",views:1,open:1,settled:0,hitRate:1,averageReturn:0.1,averageExcess:0.04,benchmarkCovered:1,recent:[{id:"call-0",ticker:"Q0",direction:"UP",status:"OPEN",title:"",entryDate:"2026-09-01",markDate:"2026-09-30",viewReturn:0.1,benchmarkReturn:0.06,excessReturn:0.04,cited:1}]}});}
  if(url.includes("/api/users/analyst")) return r.fulfill({json:{profile:{id:"analyst",displayName:"Analyst",photoURL:null,nickname:null,bio:"",stats,latestDailyScore:null,settings:{isPublic:true,institutionDigestEnabled:false,institutionDigestCadence:"daily",institutionDigestLastSentAt:null}},relationship:{isFollowing:false},watchlists:[watchlist]}});
  if(url.includes("/api/watchlists/list")){const auth=r.request().headers().authorization;authHeaders.push(auth);return r.fulfill({json:{watchlist:{...watchlist,viewerAccess:auth?"full":"preview",livePredictions:auth?calls:calls.slice(0,3),settledPredictions:[]}}});}
  if(url.includes("/api/posts") || url.includes("/api/predictions")) return r.fulfill({json:{items:[],nextCursor:null}});
  return r.fulfill({contentType:"text/html",body:html});
 });
 await page.goto("http://profile.test/analysts/analyst");
 // The track record leads the profile; its rows are links too, so scope the watchlist counts below.
 const record=page.getByRole("region",{name:"Track record"});
 await expect(record.getByText("+4.0%",{exact:true}).first()).toBeVisible();
 await expect(record.getByRole("link",{name:/Q0 · Bullish/})).toHaveAttribute("href","/en/predictions/call-0");
 await expect(page.locator('a[href^="/predictions/call-"]:not(section[aria-labelledby="track-record-heading"] a)').filter({ hasText: /Q\d/ })).toHaveCount(3);
 await page.getByText("Legacy groups", { exact: true }).click();
 await expect(page.getByRole("link",{name:"Sign in to unlock full watchlist"})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent("test-auth-user",{detail:"alice"})));
 await expect(page.locator('a[href^="/predictions/call-"]:not(section[aria-labelledby="track-record-heading"] a)').filter({ hasText: /Q\d/ })).toHaveCount(9);
 expect(authHeaders.at(-1)).toBe("Bearer isolated-test-token");
 // The track record is requested with the viewer's token, so owners of private profiles can see theirs.
 await expect.poll(()=>recordAuth.at(-1)).toBe("Bearer isolated-test-token");
 await expect(page.getByRole("link",{name:"Sign in to unlock full watchlist"})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent("test-auth-user",{detail:null})));
 await expect(page.locator('a[href^="/predictions/call-"]:not(section[aria-labelledby="track-record-heading"] a)').filter({ hasText: /Q\d/ })).toHaveCount(3);
 expect(authHeaders.at(-1)).toBeUndefined();
});


