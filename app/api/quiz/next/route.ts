import { NextRequest, NextResponse } from "next/server";
import {getCurrentUser,isReviewer} from '@/app/auth';
import { env } from "cloudflare:workers";
import { trialQuestions } from "@/lib/quiz-bank";
export async function GET(request:NextRequest){
 const db=env.DB;if(!db)return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
 const u=await getCurrentUser();if(!u)return NextResponse.json({error:"SIGN_IN_REQUIRED"},{status:401});
 const quota=await db.prepare("SELECT COUNT(*) AS total FROM quiz_served WHERE user_id=? AND created_at>=datetime('now','-1 hour')").bind(u.userId).first<{total:number}>();
 if((quota?.total??0)>=120)return NextResponse.json({error:'HOURLY_LIMIT'},{status:429});
 const level=request.nextUrl.searchParams.get("level")||"سهل";
 const seen=await db.prepare("SELECT DISTINCT question_id FROM quiz_attempts WHERE user_id=?").bind(u.userId).all<{question_id:string}>();
 const ids=new Set(seen.results.map(x=>x.question_id));
 const pool=trialQuestions.filter(q=>q.level===level);
 const available=pool.filter(q=>!ids.has(q.id));
 const candidates=available.length?available:pool;
 const q=candidates[Math.floor(Math.random()*candidates.length)];
 if(!q)return NextResponse.json({error:"NO_QUESTIONS"},{status:404});
 const options=[...q.options];for(let i=options.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[options[i],options[j]]=[options[j],options[i]]}
 const token=crypto.randomUUID();
 await db.prepare("INSERT INTO quiz_served(token,user_id,question_id,expires_at) VALUES(?,?,?,datetime('now','+15 minutes'))").bind(token,u.userId,q.id).run();
 return NextResponse.json({question:{id:q.id,level:q.level,type:q.type,prompt:q.prompt,options,targets:q.targets?.map(t=>({label:t.label})),hint:q.hint},token,remaining:available.length,trial:true});
}
