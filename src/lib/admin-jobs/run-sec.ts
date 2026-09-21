import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import { getDecodedUserFromRequest } from "../firebase/auth";
import { isAdminUser } from "../firebase/admin-role";
import { getAdminFirestore } from "../firebase/admin";
import { FUNDAMENTALS_COLLECTION } from "../fundamentals/service";
import { maintenanceError } from "../maintenance-log";
import { scheduledJobs } from "./model";

export async function reserveSecDispatch(db: ReturnType<typeof getAdminFirestore>, uid: string, now = Date.now()) {
  const ref = db.collection(FUNDAMENTALS_COLLECTION).doc("_worker");
  // Separate from the execution lease: the worker must still acquire its own lock.
  const accepted = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (Number(current?.leaseExpiresAtMs) > now || Number(current?.manualDispatchUntil) > now) return false;
    tx.set(ref, {manualDispatchUntil:now+120_000,manualRequestedBy:uid,manualRequestedAt:new Date(now).toISOString()}, {merge:true});
    return true;
  });
  if (!accepted) throw Object.assign(new Error("SEC fundamentals is already running or was recently requested."), {code:"ALREADY_RUNNING"});
}

export async function startSecJob(uid: string) {
  const project = process.env.GCP_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) throw new Error("Cloud project is not configured");
  const region = process.env.GCP_REGION || "us-central1";
  await reserveSecDispatch(getAdminFirestore(), uid);
  const client = await new GoogleAuth({scopes:["https://www.googleapis.com/auth/cloud-platform"]}).getClient();
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${scheduledJobs.fundamentals.worker}:run`;
  // Do not retry an ambiguous POST: it may already have created an execution.
  const response = await client.request<{name:string}>({url,method:"POST",data:{},timeout:20_000,retry:false});
  console.info(JSON.stringify({severity:"INFO",event:"admin_sec_job_requested",requestedBy:uid,operation:response.data.name}));
  return {operation:response.data.name};
}

export async function runSecResponse(request: NextRequest, dependencies = {getUser:getDecodedUserFromRequest,isAdmin:isAdminUser,start:startSecJob}) {
  const reply = (data:unknown,status:number) => NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
  const user = await dependencies.getUser(request);
  if (!user) return reply({error:"Unauthorized"},401);
  if (!await dependencies.isAdmin(user)) return reply({error:"Forbidden"},403);
  try { return reply({ok:true,...await dependencies.start(user.uid)},202); }
  catch(error) {
    const details = maintenanceError(error);
    console.error(JSON.stringify({severity:"ERROR",event:"admin_sec_job_request_failed",requestedBy:user.uid,error:details}));
    return reply({error:details.code === "ALREADY_RUNNING" ? "SEC fundamentals is already running or was recently requested. Check run history." : "Could not confirm the job started. Refresh run history before retrying."},details.code === "ALREADY_RUNNING" ? 409 : 502);
  }
}
