import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from flask import Flask
import library
class LibraryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  catalog=self.root/'00-START-HERE/catalog';catalog.mkdir(parents=True)
  original=self.root/'RHODES AND SCHWARZE/RTB24/Manuals/test.pdf';original.parent.mkdir(parents=True);original.write_bytes(b'%PDF-test')
  (catalog/'text.txt').write_text('--- PAGE 1 ---\nTrigger controls\n--- PAGE 2 ---\nSCPI commands')
  item={'path':str(original.relative_to(self.root)).replace('\\','/'),'sha256':'a'*64,'extracted_text':'00-START-HERE/catalog/text.txt'}
  (catalog/'documents.json').write_text(json.dumps([item,item,{'path':'ME.docx','sha256':'b'*64}]))
  self.data=library.build(self.root);self.p=patch.object(library,'data',return_value=self.data);self.p.start();self.r=patch.object(library,'root_path',return_value=self.root);self.r.start()
  app=Flask(__name__);app.register_blueprint(library.library);self.client=app.test_client()
 def tearDown(self):
  self.p.stop();self.r.stop();self.data[0].close();self.temp.cleanup()
 def test_dedup_and_scope(self):
  d=self.client.get('/api/library/documents').json
  self.assertEqual(len(d['documents']),1);self.assertEqual(d['indexed_pages'],2)
 def test_search_source_page(self):
  d=self.client.get('/api/library/search?q=SCPI').json['results'];self.assertEqual(d[0]['page'],2)
 def test_filter(self):
  self.assertEqual(self.client.get('/api/library/search?q=trigger&family=unknown').json['results'],[])
 def test_no_match(self):
  self.assertEqual(self.client.get('/api/library/search?q=zzmissing').json['results'],[])
 def test_page_and_unknown(self):
  self.assertEqual(self.client.get('/api/library/page/'+('a'*20)+'/2').json['text'],'SCPI commands')
  self.assertEqual(self.client.get('/api/library/page/'+('a'*20)+'/9').status_code,404)
 def test_arbitrary_files_denied(self):
  self.assertEqual(self.client.get('/api/library/file/not-in-catalog').status_code,404)
  with self.assertRaises(ValueError):library.safe_path(self.root,'../secrets')
 def test_punctuation_safe(self):
  self.assertEqual(self.client.get('/api/library/search?q=%22%20OR%20*').status_code,200)
if __name__=='__main__':unittest.main()
