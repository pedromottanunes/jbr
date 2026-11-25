import json
import tempfile
from pathlib import Path
import unittest
from contextlib import closing
import collector as c
import sync
import enrich

class Client:
    attempts=0
    max_requests=50
    def get(self,path,params=None):
        self.attempts+=1
        if self.attempts>self.max_requests:raise c.BudgetExhausted('Budget')
        if path=='/v1/organizations/org/':return {'organizationMembers':[{'id':'person','displayName':'Consultor teste','_t':'OrganizationHumanAgentReferenceModel','active':True}]}
        if path=='/v1/chats/':
            if params['Skip'] or params['ChatState']=='Open':return {'items':[]}
            return {'items':[{'id':'chat','_t':'BasicChatModel','createdAtUTC':'2026-11-23T11:00:00Z','eventAtUTC':'2026-11-23T11:02:00Z','firstContactMessage':{'eventAtUTC':'2026-11-23T11:00:00Z'},'contact':{'id':'contact','contactType':'DirectMessage','name':'Teste'},'channel':{'id':'channel','_t':'ChatBrokerWhatsappChannelReferenceModel'},'lastMessage':{'eventAtUTC':'2026-11-23T11:02:00Z'},'open':False,'timeline':[]}]}
        if 'relative-messages' in path:
            assert params['IncludeMetadata']=='true'
            return {'hasMessagesBeforeAllowedOrganizationPlan':False,'messages':[{'id':'message','_t':'MessageModel','eventAtUTC':'2026-11-23T11:00:00Z','source':'Contact','content':'Oi','messageType':'Text'},{'id':'transfer','_t':'MemberTransferMetadataModel','eventAtUTC':'2026-11-23T11:01:00Z','newMemberId':'person'}]}
        if path=='/v1/contact-ratings/':return {'items':[]}
        raise AssertionError('Unexpected path')

class EnrichmentTests(unittest.TestCase):
    def test_resume_and_separate_events_from_messages(self):
        with tempfile.TemporaryDirectory() as folder:
            with closing(c.connect_db(Path(folder)/'cache.db')) as db:
                sync.schema(db);enrich.schema(db)
                for _ in range(2):
                    enrich.run(db,Client(),'org',90);sync.publish(db)
                    self.assertEqual(db.execute('SELECT count(*) FROM messages').fetchone()[0],1)
                    self.assertEqual(db.execute('SELECT count(*) FROM service_events').fetchone()[0],1)
                    self.assertEqual(db.execute('SELECT count(*) FROM crm_messages').fetchone()[0],1)
                    self.assertEqual(db.execute('SELECT complete FROM service_progress').fetchone()[0],1)
                    self.assertEqual(json.loads(db.execute("SELECT value FROM crm_meta WHERE key='attendanceSync'").fetchone()[0])['status'],'complete')
    def test_budget_does_not_report_complete_or_lose_saved_roster(self):
        with tempfile.TemporaryDirectory() as folder:
            db=c.connect_db(Path(folder)/'cache.db');sync.schema(db);enrich.schema(db)
            client=Client();client.max_requests=2
            enrich.run(db,client,'org',90)
            self.assertEqual(db.execute('SELECT count(*) FROM crm_members').fetchone()[0],1)
            self.assertEqual(json.loads(db.execute("SELECT value FROM crm_meta WHERE key='attendanceSync'").fetchone()[0])['status'],'partial')
            db.close()

if __name__=='__main__':unittest.main()
