import json
import tempfile
from pathlib import Path
import unittest
import collector as c
import sync

class PublicationTest(unittest.TestCase):
 def test_identity_and_idempotency(self):
  with tempfile.TemporaryDirectory() as folder:
   db=c.connect_db(Path(folder)/'test.db');sync.schema(db)
   for chat_id,kind in [('a','DirectMessage'),('b','DirectMessage'),('group','Group')]:
    chat={'id':chat_id,'contact':{'id':'same-person','name':'Teste','contactType':kind,'phoneNumber':'5500000000000'},'createdAtUTC':'2026-11-01T00:00:00Z','open':True}
    db.execute('INSERT INTO chats VALUES (?,?,?,?)',('org',chat_id,'channel',json.dumps(chat)))
   m={'id':'message','source':'Contact','messageType':'Text','content':'Teste'}
   db.execute('INSERT INTO messages VALUES (?,?,?,?,?)',('org','a','message','2026-11-20T10:00:00Z',json.dumps(m)))
   db.commit()
   for _ in range(2):
    sync.publish(db)
    self.assertEqual(db.execute('SELECT count(*) FROM crm_contacts').fetchone()[0],1)
    self.assertEqual(db.execute('SELECT count(*) FROM crm_chats').fetchone()[0],2)
    self.assertEqual(db.execute('SELECT count(*) FROM crm_messages').fetchone()[0],1)
    self.assertEqual(db.execute('SELECT first_inbound_at FROM crm_contacts').fetchone()[0],'2026-11-20T10:00:00Z')
   db.close()

if __name__=='__main__':unittest.main()
