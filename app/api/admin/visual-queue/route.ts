import {NextResponse} from 'next/server';
import {getCurrentUser,isReviewer} from '@/app/auth';
import {env} from 'cloudflare:workers';
import {auditAdminDenied} from '@/lib/audit-denied';
import {archivePositions as positions,visualQueue as chosen} from '@/lib/visual-queue';

export async function GET(req?:Request){
 const user=await getCurrentUser();
 const allowed=isReviewer(user);
 if(!allowed){await auditAdminDenied(req,'/api/admin/visual-queue');return NextResponse.json({error:'REVIEWER_ACCESS_REQUIRED'},{status:403})}
 if(!env.DB)return NextResponse.json({error:'DATABASE_UNAVAILABLE'},{status:503});
 const placeholders=chosen.map(()=>'?').join(',');
 const recent=await env.DB.prepare(
  `SELECT content_id,decision,note,created_at FROM reviews WHERE content_id IN (${placeholders}) ORDER BY created_at DESC`
 ).bind(...chosen.map(r=>r.id)).all<{content_id:string;decision:string;note:string;created_at:string}>();
 const latest=new Map<string,{decision:string;note:string;created_at:string}>();
 for(const review of recent.results)if(!latest.has(review.content_id))latest.set(review.content_id,review);
 return NextResponse.json({
  total:chosen.length,
  rows:chosen.map((r,i)=>({id:r.id,sequence:positions.get(r.id),priority:i+1,world:r.world,
   title:r.title,source:r.source,location:r.location,review:latest.get(r.id)||null})),
  publication:'DISABLED_PENDING_SEPARATE_EDITORIAL_RELEASE'
 },{headers:{'Cache-Control':'private, no-store'}});
}
