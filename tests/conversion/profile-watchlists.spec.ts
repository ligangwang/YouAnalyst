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
 await page.route("**/*",r=>{
  const url=r.request().url();
  if(url.includes("/api/users/analyst")) return r.fulfill({json:{profile:{id:"analyst",displayName:"Analyst",photoURL:null,nickname:null,bio:"",stats,latestDailyScore:null,settings:{isPublic:true,institutionDigestEnabled:false,institutionDigestCadence:"daily",institutionDigestLastSentAt:null}},relationship:{isFollowing:false},watchlists:[watchlist]}});
  if(url.includes("/api/watchlists/list")){const auth=r.request().headers().authorization;authHeaders.push(auth);return r.fulfill({json:{watchlist:{...watchlist,viewerAccess:auth?"full":"preview",livePredictions:auth?calls:calls.slice(0,3),settledPredictions:[]}}});}
  return r.fulfill({contentType:"text/html",body:html});
 });
 await page.goto("http://profile.test/analysts/analyst");
 await expect(page.locator('a[href^="/predictions/call-"]').filter({ hasText: /Q\d/ })).toHaveCount(3);
 await expect(page.getByRole("link",{name:"Sign in to unlock full watchlist"})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent("test-auth-user",{detail:"alice"})));
 await expect(page.locator('a[href^="/predictions/call-"]').filter({ hasText: /Q\d/ })).toHaveCount(9);
 expect(authHeaders.at(-1)).toBe("Bearer isolated-test-token");
 await expect(page.getByRole("link",{name:"Sign in to unlock full watchlist"})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent("test-auth-user",{detail:null})));
 await expect(page.locator('a[href^="/predictions/call-"]').filter({ hasText: /Q\d/ })).toHaveCount(3);
 expect(authHeaders.at(-1)).toBeUndefined();
});


