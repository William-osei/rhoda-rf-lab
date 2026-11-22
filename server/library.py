"""Read-only, local document library. No cloud provider or instrument access."""
import json, os, re, sqlite3, threading
from pathlib import Path
from flask import Blueprint, jsonify, request, send_file, abort
library = Blueprint('library', __name__)
_lock = threading.Lock()
_cache = None


def unavailable_resource(_error):
    return jsonify({'error':'Local resource unavailable. Check the resource folder and catalogue, then retry.'}),503


# Page/file routes must disclose catalogue failure as JSON just like search/list.
# These handlers do not intercept an ordinary missing document or page (404).
for _error_type in (OSError, ValueError, KeyError, TypeError, sqlite3.Error):
    library.register_error_handler(_error_type, unavailable_resource)

def root_path():
    return Path(os.environ.get('RHODA_RESOURCE_ROOT', str(Path.home() / 'OneDrive/Desktop/R&S'))).resolve()

def safe_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root): raise ValueError('Path outside resource root')
    return path

def build(root):
    catalog = root / '00-START-HERE/catalog/documents.json'
    entries = json.loads(catalog.read_text(encoding='utf-8'))
    additions = root / '00-START-HERE/catalog/official-additions.json'
    if additions.is_file(): entries += json.loads(additions.read_text(encoding='utf-8'))
    conn = sqlite3.connect(':memory:', check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute('CREATE VIRTUAL TABLE pages USING fts5(doc UNINDEXED, page UNINDEXED, title, text, tokenize="unicode61")')
    docs = {}; seen = set(); page_count = 0
    for entry in entries:
        relative = entry['path']
        if not (relative.startswith('RHODES AND SCHWARZE/') or relative.startswith('Lab-assistant/') or relative == 'Rhoda_Technical_Report.pdf'): continue
        if entry['sha256'] in seen: continue
        source = safe_path(root, relative)
        if source.suffix.lower() not in ('.pdf','.docx') or not source.is_file(): continue
        text_path = safe_path(root, entry.get('extracted_text','missing'))
        if not text_path.is_file(): continue
        seen.add(entry['sha256']); ident = entry['sha256'][:20]
        text = text_path.read_text(encoding='utf-8')
        parts = re.split(r'--- PAGE (\d+) ---', text)
        pages = [(int(parts[i]), parts[i+1].strip()) for i in range(1,len(parts)-1,2)] if len(parts)>1 else [(1,text)]
        family = relative.split('/')[1] if relative.startswith('RHODES AND SCHWARZE/') else 'RHODA project'
        family = entry.get('family',family)
        group = 'Manuals' if '/Manuals/' in relative else 'Specifications & brochures' if '/Brochures and Data Sheets/' in relative else 'Applications' if '/Applications/' in relative or '/Apllications/' in relative else 'Drivers & supporting documents' if '/Drivers/' in relative else 'Project documents'
        docs[ident] = {'id':ident,'title':entry.get('title',source.name),'path':relative,'family':family,'category':entry.get('category',group),'source_url':entry.get('source_url'),'retrieved':entry.get('retrieved'),'pages':len(pages),'format':source.suffix[1:],'source_kind':'Supplied company resource' if relative.startswith('RHODES') else 'Project document'}
        for page,content in pages:
            conn.execute('INSERT INTO pages VALUES (?,?,?,?)',(ident,page,source.name,content)); page_count+=1
    conn.commit()
    return conn,docs,page_count

def data():
    global _cache
    with _lock:
        if _cache is None: _cache=build(root_path())
        return _cache

@library.get('/api/library/documents')
def documents():
    try:
        _,docs,count=data()
        return jsonify({'documents':list(docs.values()),'indexed_pages':count,'offline':True,'note':'Exact duplicates collapsed. PDF page numbers are file pages, not printed numbering. Extracted text can omit diagrams or misread tables; verify the original.'})
    except (OSError,ValueError) as error:
        return jsonify({'error':'Local catalogue unavailable. Set RHODA_RESOURCE_ROOT to the folder containing 00-START-HERE/catalog.'}),503

STOP=set('the a an how what why to of and in on for is are i me my can please help explain about with would should'.split())
def terms_for(query):
    query=query.lower().replace('intruments','instruments').replace('oscilloscope','oscilloscop')
    return [w for w in re.findall(r'[a-z0-9]+',query) if len(w)>2 and w not in STOP][:12]

@library.get('/api/library/search')
def search():
    query=request.args.get('q','')[:300]; terms=terms_for(query)
    if not terms: return jsonify({'results':[],'query':query})
    try: conn,docs,_=data()
    except (OSError,ValueError): return jsonify({'error':'Local catalogue unavailable'}),503
    expression=' OR '.join('"'+word+'"*' for word in terms)
    family=request.args.get('family',''); category=request.args.get('category','')
    # Filter IDs before ranking so a family cannot disappear behind other results.
    ids=[k for k,v in docs.items() if (not family or v['family']==family) and (not category or v['category']==category)]
    if not ids: return jsonify({'results':[],'query':query})
    rows=conn.execute("SELECT doc,page,snippet(pages,3,'','',' ... ',64) AS excerpt,bm25(pages,0,0,2,1) AS rank FROM pages WHERE pages MATCH ? AND doc IN ("+','.join('?' for _ in ids)+") ORDER BY CASE WHEN text LIKE '%........%' THEN 1 ELSE 0 END, rank LIMIT 30",[expression,*ids]).fetchall()
    results=[]
    for row in rows:
        results.append({**docs[row['doc']],'page':row['page'],'excerpt':row['excerpt'][:1200]})
    return jsonify({'results':results,'query':query,'method':'Local keyword search; excerpts, not generated answers'})

@library.get('/api/library/page/<ident>/<int:page>')
def page(ident,page):
    conn,docs,_=data()
    if ident not in docs: abort(404)
    row=conn.execute('SELECT text FROM pages WHERE doc=? AND page=?',(ident,page)).fetchone()
    if row is None: abort(404)
    return jsonify({'document':docs[ident],'page':page,'text':row['text']})

@library.get('/api/library/file/<ident>')
def original(ident):
    _,docs,_=data()
    if ident not in docs: abort(404)
    response=send_file(safe_path(root_path(),docs[ident]['path']),as_attachment=False)
    response.headers['X-Content-Type-Options']='nosniff'
    return response
