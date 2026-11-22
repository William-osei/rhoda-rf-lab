import json,hashlib,urllib.request
from pathlib import Path
from pypdf import PdfReader
root=Path('C:/Users/trick/OneDrive/Desktop/R&S'); dest=root/'RHODES AND SCHWARZE/Official additions 2026-09-30';dest.mkdir(exist_ok=True)
sources=[('Remote_Control_SCPI_GettingStarted_en_04.pdf','Automation','https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_manuals/getting_started/1179_4592_01/Remote_Control_SCPI_GettingStarted_en_04.pdf'),('1MA265_2e_Educational_Oscilloscope.pdf','RTB24','https://cdn.rohde-schwarz.com/pws/dl_downloads/dl_application/application_notes/1ma265/1MA265_2e_Educational_Oscilloscope.pdf'),('RTB2_UserManual_en_03.pdf','RTB24','https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_manuals/user_manual/1333_1611_01/RTB2_UserManual_en_03.pdf')]
entries=[]
for name,family,url in sources:
 try:
  data=urllib.request.urlopen(url,timeout=60).read()
  if not data.startswith(b'%PDF'):raise ValueError('Not a PDF')
  file=dest/name;file.write_bytes(data);reader=PdfReader(file)
  text=dest/(name+'.txt');text.write_text('\n\n'.join(f'--- PAGE {i+1} ---\n'+(p.extract_text() or '') for i,p in enumerate(reader.pages)),encoding='utf-8')
  entries.append({'path':file.relative_to(root).as_posix(),'sha256':hashlib.sha256(data).hexdigest(),'extracted_text':text.relative_to(root).as_posix(),'family':family,'category':'Official additions','source_url':url,'retrieved':'2026-09-30','pages':len(reader.pages)})
  print(name,len(reader.pages),'pages',flush=True)
 except Exception as e:print(name,type(e).__name__,flush=True)
(root/'00-START-HERE/catalog/official-additions.json').write_text(json.dumps(entries,indent=2),encoding='utf-8')
