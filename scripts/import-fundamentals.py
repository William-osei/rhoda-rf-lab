"""Append the official fundamentals primer without replacing earlier catalogue entries."""
import json,hashlib,urllib.request
from pathlib import Path
from pypdf import PdfReader
root=Path('C:/Users/trick/OneDrive/Desktop/R&S')
dest=root/'RHODES AND SCHWARZE/Official additions 2026-10-01';dest.mkdir(exist_ok=True)
url='https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/dl_common_library/dl_brochures_and_datasheets/pdf_1/Oscilloscope-Fundamentals_bro_en_3608-2720-62_v0200.pdf'
name='Oscilloscope-Fundamentals_bro_en_3608-2720-62_v0200.pdf'
file=dest/name
data=file.read_bytes() if file.exists() else urllib.request.urlopen(url,timeout=45).read()
if not data.startswith(b'%PDF'):raise ValueError('Not a PDF')
reader=PdfReader(__import__('io').BytesIO(data));file.write_bytes(data)
txt=dest/(name+'.txt');txt.write_text('\n\n'.join(f'--- PAGE {i+1} ---\n'+(page.extract_text() or '') for i,page in enumerate(reader.pages)),encoding='utf-8')
catalog=root/'00-START-HERE/catalog/official-additions.json';entries=json.loads(catalog.read_text(encoding='utf-8'))
digest=hashlib.sha256(data).hexdigest()
if not any(e['sha256']==digest for e in entries):entries.append({'path':file.relative_to(root).as_posix(),'sha256':digest,'extracted_text':txt.relative_to(root).as_posix(),'family':'Oscilloscope fundamentals','category':'Official additions','source_url':url,'retrieved':'2026-10-01','pages':len(reader.pages)})
staged=catalog.with_suffix('.tmp');staged.write_text(json.dumps(entries,indent=2),encoding='utf-8');staged.replace(catalog)
print('Indexed official primer:',len(reader.pages),'pages; additions:',len(entries))
