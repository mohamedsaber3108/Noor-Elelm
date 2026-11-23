import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { env } from "cloudflare:workers";
import { trialQuestions } from "@/lib/quiz-bank";
export async function POST(request:NextRequest){
 const db=env.DB;if(!db)return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
 const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"SIGN_IN_REQUIRED"},{status:401});
 let body:{questionId?:string;answerKey?:string;token?:string};try{body=await request.json()}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400})}
 const q=trialQuestions.find(x=>x.id===body.questionId);
 const keys=body.answerKey?.split(',')||[];
 const valid=!!q&&(q.type==='ordering'||q.type==='matching'?keys.length===q.options.length&&new Set(keys).size===q.options.length&&keys.every(k=>q.options.some(o=>o.key===k)):q.options.some(x=>x.key===body.answerKey));
 if(!valid||!body.token||!body.token.match(/^[0-9a-f-]{36}$/))return NextResponse.json({error:"INVALID_ANSWER"},{status:400});
 const quota=await db.prepare("SELECT COUNT(*) AS total FROM quiz_attempts WHERE user_id=? AND created_at>=datetime('now','-1 hour')").bind(u.userId).first<{total:number}>();
 if((quota?.total??0)>=120)return NextResponse.json({error:'HOURLY_LIMIT'},{status:429});
 const consumed=await db.prepare("UPDATE quiz_served SET consumed_at=CURRENT_TIMESTAMP WHERE token=? AND user_id=? AND question_id=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP").bind(body.token,u.userId,q.id).run();
 if(!consumed.meta.changes)return NextResponse.json({error:'INVALID_OR_USED_QUESTION_TOKEN'},{status:409});
 const correct=body.answerKey===q.correct,attemptId=crypto.randomUUID();
 const statements=[db.prepare("INSERT INTO quiz_attempts(id,user_id,question_id,answer_key,correct) VALUES(?,?,?,?,?)").bind(attemptId,u.userId,q.id,body.answerKey,correct?1:0)];
 if(correct)statements.push(db.prepare("INSERT OR IGNORE INTO point_ledger(id,user_id,question_id,kind,delta,attempt_id) VALUES(?,?,?,'FIRST_CORRECT',1,?)").bind(crypto.randomUUID(),u.userId,q.id,attemptId));
 await db.batch(statements);
 const balance=await db.prepare("SELECT COALESCE(SUM(delta),0) AS balance FROM point_ledger WHERE user_id=?").bind(u.userId).first<{balance:number}>();
 return NextResponse.json({correct,correctKey:q.correct,explanation:q.explanation,source:q.source,balance:balance?.balance??0,trial:true});
}
