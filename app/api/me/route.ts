import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { env } from "cloudflare:workers";
export async function GET(){
 const db=env.DB;if(!db)return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
 const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"SIGN_IN_REQUIRED"},{status:401});
 const [coins,answers,periods]=await Promise.all([
 db.prepare("SELECT COALESCE(SUM(delta),0) AS total FROM point_ledger WHERE user_id=?").bind(u.userId).first<{total:number}>(),
 db.prepare("SELECT COUNT(DISTINCT question_id) AS total FROM quiz_attempts WHERE user_id=? AND correct=1").bind(u.userId).first<{total:number}>(),
 db.prepare("SELECT COUNT(DISTINCT CASE WHEN created_at>=datetime('now','start of day') THEN question_id END) AS daily, COUNT(DISTINCT CASE WHEN created_at>=datetime('now','-7 days') THEN question_id END) AS weekly, COUNT(DISTINCT CASE WHEN created_at>=datetime('now','-30 days') THEN question_id END) AS monthly FROM quiz_attempts WHERE user_id=? AND correct=1").bind(u.userId).first<{daily:number;weekly:number;monthly:number}>()]);
 return NextResponse.json({name:u.displayName,coins:coins?.total??0,correct:answers?.total??0,challenges:[{key:'daily',label:'تحدي اليوم',completed:Math.min(periods?.daily??0,3),target:3},{key:'weekly',label:'تحدي الأسبوع',completed:Math.min(periods?.weekly??0,7),target:7},{key:'monthly',label:'تحدي الشهر',completed:Math.min(periods?.monthly??0,12),target:12}],trial:true});
}
