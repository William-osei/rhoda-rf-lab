"""Append public primary-source PDFs; preserve earlier catalogue entries and attribution."""
import hashlib, io, json, urllib.request
from pathlib import Path
from pypdf import PdfReader
root=Path('C:/Users/trick/OneDrive/Desktop/R&S')
dest=root/'RHODES AND SCHWARZE/Official additions 2026-10-03'
dest.mkdir(exist_ok=True)
catalog=root/'00-START-HERE/catalog/official-additions.json'
entries=json.loads(catalog.read_text(encoding='utf-8'))
sources=[
 ('Making_Better_Oscilloscope_Measurements.pdf','Oscilloscope fundamentals','R&S — Making Better Oscilloscope Measurements','https://cdn.rohde-schwarz.com/pws/campaigns/rsa/Rohde_Schwarz_Making_Better_Scope_Measurements_Whitepaper_V1.pdf'),
 ('Instrument_Fundamentals_Oscilloscope_Basics.pdf','Oscilloscope fundamentals','R&S — Instrument Fundamentals: Oscilloscope Basics','https://cdn.rohde-schwarz.com/ymkt/na/content/Instrument_Fundamentals_seminar_materials/6_Instrument_Fundamentals_-_Oscilloscope_Basics.pdf'),
 ('NIST_AI_100_1_AI_Risk_Management_Framework.pdf','AI & ML','NIST — AI Risk Management Framework 1.0','https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf')]
for name,family,title,url in sources:
 file=dest/name
 try:
  data=file.read_bytes() if file.exists() else urllib.request.urlopen(url,timeout=45).read()
 except Exception as error:
  print('Online reference only:',title,type(error).__name__,flush=True)
  continue
 if not data.startswith(b'%PDF'):raise ValueError('Not a PDF: '+name)
 reader=PdfReader(io.BytesIO(data));file.write_bytes(data)
 txt=dest/(name+'.txt');txt.write_text('\n\n'.join(f'--- PAGE {i+1} ---\n'+(page.extract_text() or '') for i,page in enumerate(reader.pages)),encoding='utf-8')
 digest=hashlib.sha256(data).hexdigest()
 if not any(e['sha256']==digest for e in entries):entries.append(dict(path=file.relative_to(root).as_posix(),sha256=digest,extracted_text=txt.relative_to(root).as_posix(),family=family,title=title,category='Learning references',source_url=url,retrieved='2026-10-03',pages=len(reader.pages)))
 print(title,len(reader.pages),'pages',flush=True)
 # Commit each successful download atomically so a later network failure loses nothing.
 staged=catalog.with_suffix('.tmp');staged.write_text(json.dumps(entries,indent=2),encoding='utf-8');staged.replace(catalog)
