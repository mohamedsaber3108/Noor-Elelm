from pathlib import Path
from docx import Document
import csv,json,re,hashlib,subprocess
from openpyxl import load_workbook
ROOT=Path('/workspace/scratch/384ec8fe11ef/extracted_source')
OUT=Path(__file__).resolve().parents[1]
rows=[]; claims=[]; coverage=[]; topics={}; issues=[]
paths=sorted(p for p in ROOT.rglob('*') if p.is_file())
for fi,p in enumerate(paths,1):
 rel=str(p.relative_to(ROOT)); cat=rel.split('/')[0] if '/' in rel else 'جذر الأرشيف'
 paras=[]
 if p.suffix=='.docx':
  doc=Document(p)
  paras=[(f'p{i+1}',x.text.strip()) for i,x in enumerate(doc.paragraphs) if x.text.strip()]
  for ti,t in enumerate(doc.tables):
   for ri,row in enumerate(t.rows):
    v=' | '.join(' '.join(c.text.split()) for c in row.cells)
    if v.strip(' |'):paras.append((f't{ti+1}r{ri+1}',v))
 elif p.suffix=='.pdf':
  s=subprocess.check_output(['pdftotext','-layout',str(p),'-'],text=True)
  paras=[(f'l{i+1}',x.strip()) for i,x in enumerate(s.splitlines()) if x.strip()]
 elif p.suffix=='.xlsx':
  wb=load_workbook(p,read_only=True,data_only=True)
  for ws in wb:
   for ri,row in enumerate(ws.values,1):
    s=' | '.join(str(x) for x in row if x is not None)
    if s: paras.append((f'{ws.title}!{ri}',s))
 title=p.stem
 is_instruction=bool(re.search(r'أنت الآن مساعد|أنا محتاج منك|المطلوب هو تقسيم', ' '.join(x[1] for x in paras[:4]), re.I))
 headings=[]
 for loc,s in paras:
  if re.search(r'(?:إنفوغرافيك|الإنفوغرافيك|العنوان|محور|المحور|فصل|درس|حديث|\d+\s*[:ـ-])',s[:90]) and len(s)<250:
   headings.append(s[:180]);topics.setdefault(cat,[]).append({'title':s[:180],'source_file':rel,'location':loc})
  typ='instruction' if is_instruction or re.search(r'^(?:صمّم|أنت مساعد|يجب عليك|المطلوب هو)',s[:100]) else ('citation_candidate' if re.search(r'^\s*(?:https?://|\[\d+\]|المصدر:)',s) else 'claim_candidate')
  cid='NAI-'+hashlib.sha256((rel+loc+s).encode()).hexdigest()[:12]
  claims.append({'claim_id':cid,'source_file':rel,'location':loc,'raw_quote':s[:1500],'claim_type':typ,'primary_reference':'','exact_reference':'','verification_status':'NEEDS_SOURCE','reviewer':'','notes':'Imported candidate; no publication approval'})
  coverage.append({'claim_id':cid,'world':cat,'topic':headings[-1] if headings else title,'chapter':'','lesson':'pending review','fact':'pending review','infographic':'candidate' if 'إنفو' in s else '', 'quiz':'not eligible','publication_status':'DRAFT'})
 rows.append({'source_path':rel,'category':cat,'file_type':p.suffix,'title_detected':title,'paragraphs_or_rows':len(paras),'candidate_headings':len(headings),'review_status':'NOT_REVIEWED','potential_instruction_file':is_instruction,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 if is_instruction:issues.append(f'- `{rel}`: appears to be instructions/template or generic Untitled; classify before fact checking.')
for name,records in [('SOURCE_INVENTORY.csv',rows),('CLAIM_AUDIT.csv',claims),('CONTENT_COVERAGE_MATRIX.csv',coverage)]:
 with (OUT/'research'/name).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=records[0]);w.writeheader();w.writerows(records)
(OUT/'data'/'source-topics.json').write_text(json.dumps(topics,ensure_ascii=False,indent=2))
(OUT/'research'/'EDITORIAL_ISSUES.md').write_text('# Editorial issues\n\nEvery imported statement is unverified. The source reference PDF is a reading list, not approval. URLs, hadith grading, Quran quotations, historical dates and sectarian interpretations need individual checking.\n\n## Files requiring classification\n'+ '\n'.join(issues)+'\n')
print(json.dumps({'files':len(rows),'paragraph_candidates':len(claims),'headings':sum(map(len,topics.values())),'worlds':len(topics)},ensure_ascii=False))
