import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isReviewer,sameOrigin} from '@/app/auth';
import {env} from 'cloudflare:workers';
import records from '@/data/archive-summaries.json';
const ids=new Set((records as {id:string}[]).map(r=>r.id));
export async function GET(){
 const u=await getCurrentUser(),db=env.DB;if(!u)return NextResponse.json({error:'SIGN_IN_REQUIRED'},{status:401});if(!db)return NextResponse.json({error:'DATABASE_UNAVAILABLE'},{status:503});
 const [bookmarks,read]=await Promise.all([db.prepare('SELECT content_id FROM bookmarks WHERE user_id=?').bind(u.userId).all<{content_id:string}>(),db.prepare('SELECT lesson_id FROM progress WHERE user_id=?').bind(u.userId).all<{lesson_id:string}>()]);
 const bookmarkIds=bookmarks.results.map(x=>x.content_id),readIds=read.results.map(x=>x.lesson_id);
 const metadata=new Map((records as {id:string;title:string;world:string}[]).map(x=>[x.id,x]));
 return NextResponse.json({bookmarks:bookmarkIds,read:readIds,bookmarkItems:bookmarkIds.slice(0,20).map(id=>metadata.get(id)).filter(Boolean),readItems:readIds.slice(0,20).map(id=>metadata.get(id)).filter(Boolean)});
}
export async function POST(req:NextRequest){
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});
 const u=await getCurrentUser(),db=env.DB;if(!u)return NextResponse.json({error:'SIGN_IN_REQUIRED'},{status:401});if(!db)return NextResponse.json({error:'DATABASE_UNAVAILABLE'},{status:503});
 let b:{id?:string;action?:string};try{b=await req.json()}catch{return NextResponse.json({error:'BAD_JSON'},{status:400})}
 if(!b.id||!ids.has(b.id)||!['bookmark','unbookmark','read'].includes(b.action||''))return NextResponse.json({error:'INVALID_ACTION'},{status:400});
 if(b.action==='bookmark')await db.prepare('INSERT OR IGNORE INTO bookmarks(user_id,content_id) VALUES(?,?)').bind(u.userId,b.id).run();
 if(b.action==='unbookmark')await db.prepare('DELETE FROM bookmarks WHERE user_id=? AND content_id=?').bind(u.userId,b.id).run();
 if(b.action==='read')await db.prepare('INSERT OR IGNORE INTO progress(user_id,lesson_id) VALUES(?,?)').bind(u.userId,b.id).run();
 return NextResponse.json({ok:true,id:b.id,action:b.action});
}
