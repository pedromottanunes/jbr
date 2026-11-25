"""Local, read-only WhatsApp ingestion. Network I/O never runs from a web request."""
import argparse
from contextlib import closing
from datetime import timedelta
import json
import os
from pathlib import Path
import sqlite3
import sys
import collector as c

ROOT = Path(__file__).resolve().parents[3]
DB = ROOT / 'local-data' / 'umbler.sqlite3'

def schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS crm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS crm_contacts (id TEXT PRIMARY KEY, label TEXT NOT NULL, phone TEXT, first_inbound_at TEXT, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS crm_chats (id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, label TEXT NOT NULL, at TEXT, is_open INTEGER NOT NULL, message_count INTEGER NOT NULL, limited INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS crm_chats_recent ON crm_chats(at DESC, id);
      CREATE TABLE IF NOT EXISTS crm_messages (chat_id TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, author TEXT NOT NULL, incoming INTEGER NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL, private INTEGER NOT NULL, PRIMARY KEY(chat_id,id));
      CREATE INDEX IF NOT EXISTS crm_messages_time ON crm_messages(chat_id,at,id);
    ''')

def meta(db, key, value):
    db.execute('INSERT INTO crm_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key,json.dumps(value,ensure_ascii=False)))

def import_history(db, source_dir):
    """Explicit bootstrap; source databases are opened read-only, including their WAL."""
    files = sorted(source_dir.glob('*.sqlite3'), key=lambda p:p.stat().st_mtime)
    for path in files:
        signature = str(path.resolve()) + ':' + str(path.stat().st_size) + ':' + str(path.stat().st_mtime_ns)
        if db.execute('SELECT 1 FROM crm_meta WHERE key=?', ('import:'+signature,)).fetchone():
            continue
        with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro', uri=True)) as source, db:
            tables = {r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ('channels','chats'):
                if table not in tables: continue
                for row in source.execute('SELECT * FROM '+table):
                    if table == 'chats':
                        old = db.execute('SELECT raw_json FROM chats WHERE organization_id=? AND id=?', row[:2]).fetchone()
                        stamp = lambda raw: (json.loads(raw).get('lastMessage') or {}).get('eventAtUTC') or ''
                        if old and stamp(old[0]) > stamp(row[3]): continue
                    db.execute('INSERT OR REPLACE INTO '+table+' VALUES (?,?,?,?)',row)
            for table in ('messages','export_messages'):
                if table in tables:
                    db.executemany('INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?)', source.execute('SELECT organization_id,chat_id,id,event_at_utc,raw_json FROM '+table))
            meta(db,'import:'+signature,True)
    orgs = db.execute('SELECT DISTINCT organization_id FROM chats').fetchall()
    if len(orgs) != 1: raise c.CollectorError('A importação precisa conter uma única organização JBR.')
    with db: meta(db,'organizationId',orgs[0][0])
    print('Histórico importado, sem chamadas externas.',flush=True)

def publish(db):
    """Publish a complete local view in one transaction; preserve provider IDs."""
    contacts = {}
    tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    members={(r['organization_id'],r['id']):r['name'] for r in db.execute('SELECT * FROM crm_members')} if 'crm_members' in tables else {}
    with db:
        db.execute('DELETE FROM crm_messages')
        db.execute('DELETE FROM crm_chats')
        db.execute('DELETE FROM crm_contacts')
        for row in db.execute('SELECT * FROM chats'):
            chat=json.loads(row['raw_json']); contact=chat.get('contact') or {}
            if contact.get('contactType') != 'DirectMessage': continue
            external=contact.get('id')
            if not external: continue
            cid=row['organization_id']+':'+external
            chatid=row['organization_id']+':'+row['id']
            label=contact.get('name') or contact.get('phoneNumber') or 'Contato sem nome'
            phone=contact.get('phoneNumber')
            first=(chat.get('firstContactMessage') or {}).get('eventAtUTC')
            tags=(chat.get('tags') or [])+(contact.get('tags') or [])
            google=any('google' in str(t.get('name','')).lower() for t in tags if isinstance(t,dict))
            record=contacts.setdefault(cid,dict(id=cid,label=label,phone=phone,first=first,google=google))
            record['google'] = record['google'] or google
            last=(chat.get('lastMessage') or {}).get('eventAtUTC') or chat.get('createdAtUTC')
            count=0
            for mrow in db.execute('SELECT * FROM messages WHERE organization_id=? AND chat_id=? ORDER BY event_at_utc,id',(row['organization_id'],row['id'])):
                m=json.loads(mrow['raw_json']); source=m.get('source'); incoming=source=='Contact'
                if incoming and (not first or mrow['event_at_utc'] < first): first=mrow['event_at_utc']
                member=m.get('sentByOrganizationMember') or {}
                author='Contato' if incoming else ('Bot' if source=='Bot' else members.get((row['organization_id'],member.get('id'))) or member.get('name') or 'Equipe')
                content='\n'.join(str(m[k]) for k in ('headerContent','content','footer') if m.get(k))
                kind=str(m.get('messageType') or 'Mensagem')
                db.execute('INSERT INTO crm_messages VALUES (?,?,?,?,?,?,?,?)',(chatid,mrow['id'],mrow['event_at_utc'],author,int(incoming),content or '['+kind+']',kind,int(bool(m.get('isPrivate')))))
                count+=1
                if not last or mrow['event_at_utc']>last: last=mrow['event_at_utc']
            if first and (not record['first'] or first < record['first']): record['first']=first
            # Full-history coverage is deliberately conservative; recent-window sync is not full history.
            full=db.execute('SELECT backfill_complete,history_limited FROM chat_sync WHERE organization_id=? AND chat_id=?',(row['organization_id'],row['id'])).fetchone()
            limited=not full or not full['backfill_complete'] or full['history_limited']
            db.execute('INSERT INTO crm_chats VALUES (?,?,?,?,?,?,?)',(chatid,cid,label,last,int(bool(chat.get('open'))),count,int(bool(limited))))
        db.executemany('INSERT INTO crm_contacts VALUES (?,?,?,?,?)',[(x['id'],x['label'],x['phone'],x['first'],'Google indicado' if x['google'] else 'Não identificada') for x in contacts.values()])
        meta(db,'publishedAt',c.iso_utc(c.utc_now()))
    print('Base publicada: '+str(len(contacts))+' contatos; '+str(db.execute('SELECT count(*) FROM crm_messages').fetchone()[0])+' mensagens.',flush=True)

def sync(db, max_requests, days):
    state_path=c.runtime_state_path()
    with c.single_process_lock(state_path):
        client=c.TalkClient(os.environ.get('UTALK_API_TOKEN',''), interval=3,max_requests=max_requests,state_path=state_path)
        orgrow=db.execute("SELECT value FROM crm_meta WHERE key='organizationId'").fetchone()
        org=os.environ.get('UMBLER_ORGANIZATION_ID') or (json.loads(orgrow[0]) if orgrow else None)
        me=client.get('/v1/members/me/')
        orgs=me.get('organizations',[]) if isinstance(me,dict) else []
        if not org and len(orgs)==1: org=orgs[0]['id']
        if not org or not any(x.get('id')==org for x in orgs): raise c.CollectorError('Organização JBR não confirmada para esta credencial.')
        with db:
            meta(db,'organizationId',org)
            meta(db,'sync',{'status':'running','startedAt':c.iso_utc(c.utc_now())})
        channels=c.list_channels(client,org)
        ids=set()
        with db:
            for ch in channels:
                if ch.get('_t') in c.WHATSAPP_TYPES:
                    ids.add(ch['id']); db.execute('INSERT OR REPLACE INTO channels VALUES (?,?,?,?)',(org,ch['id'],ch['_t'],c.json_text(ch)))
        if not ids: raise c.CollectorError('Nenhum canal WhatsApp reconhecido.')
        active=db.execute("SELECT * FROM export_runs WHERE organization_id=? AND days=? AND filter_tag_id IS NULL AND status='collecting' ORDER BY id DESC LIMIT 1",(org,days)).fetchone()
        previous=db.execute("SELECT * FROM export_runs WHERE organization_id=? AND filter_tag_name='CRM JBR' AND status='completed' ORDER BY id DESC LIMIT 1",(org,)).fetchone()
        until=c.utc_now()
        start=until-timedelta(days=days)
        if previous: start=max(start,c.parse_utc(previous['until_utc'])-timedelta(minutes=5))
        run,is_new=c.export_run_for(db,org,days,None,'CRM JBR',from_utc=active['from_utc'] if active else c.iso_utc(start),until_utc=active['until_utc'] if active else c.iso_utc(until))
        def progress(status):
            done=db.execute('SELECT count(*) FROM export_chat_progress WHERE run_id=? AND complete=1',(run['id'],)).fetchone()[0]
            total=db.execute('SELECT count(*) FROM export_chat_candidates WHERE run_id=?',(run['id'],)).fetchone()[0]
            with db: meta(db,'sync',{'status':status,'checkedAt':c.iso_utc(c.utc_now()),'from':run['from_utc'],'until':run['until_utc'],'completedChats':done,'candidateChats':total,'requests':client.attempts})
            return done,total
        status='complete'
        try:
            c.discover(db,client,org,ids,refresh=is_new,cutoff_utc=run['until_utc'],export_run_id=run['id'],candidate_start_utc=run['from_utc'])
            progress('running')
            for index,item in enumerate(db.execute('SELECT chat_id FROM export_chat_candidates WHERE run_id=? ORDER BY chat_id',(run['id'],)).fetchall()):
                while True:
                    _,complete=c.sync_export_chat(db,client,run,item['chat_id'])
                    if complete: break
                if index%10==0: progress('running')
            with db:
                db.execute("UPDATE export_runs SET status='completed',completed_at_utc=? WHERE id=?",(c.iso_utc(c.utc_now()),run['id']))
        except c.BudgetExhausted:
            status='partial'
        finally:
            with db:
                db.execute('''INSERT INTO messages SELECT organization_id,chat_id,id,event_at_utc,raw_json FROM export_messages WHERE run_id=?
                  ON CONFLICT(organization_id,chat_id,id) DO UPDATE SET event_at_utc=excluded.event_at_utc,raw_json=excluded.raw_json''',(run['id'],))
        done,total=progress(status)
        print(f'Sincronização {status}: {done}/{total} conversas, {client.attempts} chamadas.',flush=True)

def main():
    c.require_legacy_mode()
    parser=argparse.ArgumentParser()
    parser.add_argument('--import-from',type=Path)
    parser.add_argument('--sync',action='store_true')
    parser.add_argument('--max-requests',type=int,default=150)
    parser.add_argument('--days',type=int,default=7)
    args=parser.parse_args()
    if not 1<=args.days<=90: parser.error('days deve estar entre 1 e 90')
    with c.single_process_lock(DB),closing(c.connect_db(DB)) as db:
        schema(db)
        try:
            if args.import_from: import_history(db,args.import_from)
            if args.sync: sync(db,args.max_requests,args.days)
        except (c.CollectorError,OSError,sqlite3.Error):
            with db: meta(db,'sync',{'status':'error','checkedAt':c.iso_utc(c.utc_now()),'message':'A coleta parou. Verifique a credencial, a conexão e o estado de espera antes de retomar.'})
            print('Coleta interrompida; registros confirmados foram preservados.',file=sys.stderr)
            publish(db)
            return 1
        publish(db)
    return 0

if __name__=='__main__': raise SystemExit(main())
