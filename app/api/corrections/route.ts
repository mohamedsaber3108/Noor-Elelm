import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import {getCurrentUser,isReviewer} from '@/app/auth';
import records from '@/data/archive-summaries.json';

const known = new Set((records as {id:string}[]).map(x=>x.id));

export async function POST(req:NextRequest){
  const u=await getCurrentUser(); if(!u)return NextResponse.json({error:'SIGN_IN_REQUIRED'},{status:401});
  if(!env.DB)return NextResponse.json({error:'DATABASE_UNAVAILABLE'},{status:503});
  let body:{contentId?:string;message?:string;sourceUrl?:string};
  try{body=await req.json()}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400})}
  const contentId=body.contentId?.trim()||'',message=body.message?.trim()||'',sourceUrl=body.sourceUrl?.trim()||'';
  if(!known.has(contentId)||message.length<20||message.length>2000||sourceUrl.length>500)
    return NextResponse.json({error:'INVALID_REPORT'},{status:400});
  if(sourceUrl){try{const url=new URL(sourceUrl);if(!['https:','http:'].includes(url.protocol))throw Error()}catch{return NextResponse.json({error:'INVALID_URL'},{status:400})}}
  const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE actor_id=? AND action='CORRECTION_REPORT' AND created_at>=datetime('now','-1 day')").bind(u.userId).first<{n:number}>();
  if((recent?.n||0)>=5)return NextResponse.json({error:'DAILY_LIMIT'},{status:429});
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO audit_events(id,actor_id,action,target_id,detail_json) VALUES(?,?,?,?,?)')
    .bind(id,u.userId,'CORRECTION_REPORT',contentId,JSON.stringify({message,sourceUrl,status:'OPEN'})).run();
  return NextResponse.json({id,status:'RECEIVED'}, {status:201});
}

export async function GET(){
  const u=await getCurrentUser();if(!u||!isReviewer(u))return NextResponse.json({error:'REVIEWER_ACCESS_REQUIRED'},{status:403});
  if(!env.DB)return NextResponse.json({error:'DATABASE_UNAVAILABLE'},{status:503});
  const rows=await env.DB.prepare("SELECT id,target_id,detail_json,created_at FROM audit_events WHERE action='CORRECTION_REPORT' ORDER BY created_at DESC LIMIT 100").all();
  return NextResponse.json({reports:rows.results});
}
