import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import { getDecodedUserFromRequest } from "../firebase/auth";
import { isAdminUser } from "../firebase/admin-role";
import { getAdminFirestore } from "../firebase/admin";
import { FUNDAMENTALS_COLLECTION } from "../fundamentals/service";
import { maintenanceError } from "../maintenance-log";
import { scheduledJobs } from "./model";

// Manually runnable Cloud Run workers and the lease document each one holds.
const workers = {
  privateValuations: { lease: "_private_valuation_worker", label: "Private company valuations", event: "admin_private_valuations_job" },
  fundamentals: { lease: "_worker", label: "SEC fundamentals", event: "admin_sec_job" },
  cnFundamentals: { lease: "_cn_worker", label: "A-share fundamentals", event: "admin_cn_fundamentals_job" },
} as const;
export type WorkerJob = keyof typeof workers;

export async function reserveWorkerDispatch(db: ReturnType<typeof getAdminFirestore>, uid: string, now = Date.now(), job: WorkerJob = "fundamentals") {
  const ref = db.collection(FUNDAMENTALS_COLLECTION).doc(workers[job].lease);
  // Separate from the execution lease: the worker must still acquire its own lock.
  const accepted = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (Number(current?.leaseExpiresAtMs) > now || Number(current?.manualDispatchUntil) > now) return false;
    tx.set(ref, {manualDispatchUntil:now+120_000,manualRequestedBy:uid,manualRequestedAt:new Date(now).toISOString()}, {merge:true});
    return true;
  });
  if (!accepted) throw Object.assign(new Error(`${workers[job].label} is already running or was recently requested.`), {code:"ALREADY_RUNNING"});
}
export const reserveSecDispatch = (db: ReturnType<typeof getAdminFirestore>, uid: string, now = Date.now()) => reserveWorkerDispatch(db, uid, now, "fundamentals");

export async function startWorkerJob(job: WorkerJob, uid: string) {
  const project = process.env.GCP_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) throw new Error("Cloud project is not configured");
  const region = process.env.GCP_REGION || "us-central1";
  await reserveWorkerDispatch(getAdminFirestore(), uid, Date.now(), job);
  const client = await new GoogleAuth({scopes:["https://www.googleapis.com/auth/cloud-platform"]}).getClient();
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${scheduledJobs[job].worker}:run`;
  // Do not retry an ambiguous POST: it may already have created an execution.
  const response = await client.request<{name:string}>({url,method:"POST",data:{},timeout:20_000,retry:false});
  console.info(JSON.stringify({severity:"INFO",event:`${workers[job].event}_requested`,requestedBy:uid,operation:response.data.name}));
  return {operation:response.data.name};
}
export const startSecJob = (uid: string) => startWorkerJob("fundamentals", uid);

type Dependencies = {getUser:typeof getDecodedUserFromRequest;isAdmin:typeof isAdminUser;start:(uid:string)=>Promise<{operation:string}>};
export async function runWorkerResponse(job: WorkerJob, request: NextRequest, dependencies: Dependencies = {getUser:getDecodedUserFromRequest,isAdmin:isAdminUser,start:uid=>startWorkerJob(job,uid)}) {
  const reply = (data:unknown,status:number) => NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
  const user = await dependencies.getUser(request);
  if (!user) return reply({error:"Unauthorized"},401);
  if (!await dependencies.isAdmin(user)) return reply({error:"Forbidden"},403);
  try { return reply({ok:true,...await dependencies.start(user.uid)},202); }
  catch(error) {
    const details = maintenanceError(error);
    console.error(JSON.stringify({severity:"ERROR",event:`${workers[job].event}_request_failed`,requestedBy:user.uid,error:details}));
    return reply({error:details.code === "ALREADY_RUNNING" ? `${workers[job].label} is already running or was recently requested. Check run history.` : "Could not confirm the job started. Refresh run history before retrying."},details.code === "ALREADY_RUNNING" ? 409 : 502);
  }
}
export function runSecResponse(request: NextRequest, dependencies: Dependencies = {getUser:getDecodedUserFromRequest,isAdmin:isAdminUser,start:startSecJob}) {
  return runWorkerResponse("fundamentals", request, dependencies);
}
