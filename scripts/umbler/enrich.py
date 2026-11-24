"""Read-only service analytics ingestion. Shares the main collector's process and HTTP locks."""
import argparse
from contextlib import closing
from datetime import timedelta
import json
import os
from pathlib import Path
import collector as c
import sync

def schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS crm_members (organization_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,active INTEGER NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(organization_id,id));
      CREATE TABLE IF NOT EXISTS service_chats (organization_id TEXT NOT NULL,id TEXT NOT NULL,raw_json TEXT NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(organization_id,id));
      CREATE TABLE IF NOT EXISTS service_events (organization_id TEXT NOT NULL,chat_id TEXT NOT NULL,id TEXT NOT NULL,at TEXT NOT NULL,kind TEXT NOT NULL,raw_json TEXT NOT NULL,PRIMARY KEY(organization_id,chat_id,id));
      CREATE INDEX IF NOT EXISTS service_events_time ON service_events(organization_id,chat_id,at,id);
      CREATE TABLE IF NOT EXISTS service_progress (organization_id TEXT NOT NULL,chat_id TEXT NOT NULL,cursor TEXT NOT NULL,until_utc TEXT NOT NULL,from_utc TEXT NOT NULL,complete INTEGER NOT NULL DEFAULT 0,limited INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(organization_id,chat_id));
      CREATE TABLE IF NOT EXISTS service_ratings (organization_id TEXT NOT NULL,id TEXT NOT NULL,raw_json TEXT NOT NULL,PRIMARY KEY(organization_id,id));
      CREATE TABLE IF NOT EXISTS service_coverage (organization_id TEXT NOT NULL,chat_id TEXT NOT NULL,start_utc TEXT NOT NULL,end_utc TEXT NOT NULL,PRIMARY KEY(organization_id,chat_id,start_utc));
    ''')

def save_page(db,org,chat_id,response):
    entries=response.get('messages')
    if not isinstance(entries,list):raise c.CollectorError('Página de eventos inválida.')
    for item in entries:
        if not isinstance(item,dict) or not item.get('id') or not item.get('eventAtUTC'):raise c.CollectorError('Evento sem identificação.')
        at=c.iso_utc(c.parse_utc(item['eventAtUTC']));kind=item.get('_t','')
        if kind.endswith('MetadataModel'):
            db.execute('INSERT INTO service_events VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id,chat_id,id) DO UPDATE SET at=excluded.at,kind=excluded.kind,raw_json=excluded.raw_json',(org,chat_id,item['id'],at,kind,c.json_text(item)))
        elif kind in ('MessageModel','SentMessageModel'):
            db.execute('INSERT INTO messages VALUES (?,?,?,?,?) ON CONFLICT(organization_id,chat_id,id) DO UPDATE SET event_at_utc=excluded.event_at_utc,raw_json=excluded.raw_json',(org,chat_id,item['id'],at,c.json_text(item)))
        else:raise c.CollectorError('Tipo de evento desconhecido; cursor preservado.')
    return entries

def run(db,client,org,days):
    now=c.iso_utc(c.utc_now());since=c.iso_utc(c.utc_now()-timedelta(days=days))
    def progress(status):
        with db:
            sync.meta(db,'attendanceSync',{'status':status,'checkedAt':c.iso_utc(c.utc_now()),'requests':client.attempts,'from':since,'completedChats':db.execute('SELECT count(*) FROM service_progress WHERE complete=1').fetchone()[0],'candidateChats':db.execute('SELECT count(*) FROM service_chats').fetchone()[0]})
            sync.meta(db,'attendancePublishedAt',c.iso_utc(c.utc_now()))
    progress('running')
    try:
        roster=client.get('/v1/organizations/'+c.valid_id(org,'organização')+'/')
        members=roster.get('organizationMembers')
        if not isinstance(members,list):raise c.CollectorError('Lista de atendentes inválida.')
        with db:
            for member in members:
                mid=c.valid_id(member['id'],'atendente');kind=member.get('_t','')
                db.execute('INSERT INTO crm_members VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id,id) DO UPDATE SET name=excluded.name,kind=excluded.kind,active=excluded.active,observed_at=excluded.observed_at',(org,mid,member.get('displayName') or 'Atendente sem nome',kind,int(bool(member.get('active'))),now))
        # Resumable discovery. Fetch timeline snapshots first; no per-lead request on a page view.
        row=db.execute("SELECT value FROM crm_meta WHERE key='attendanceDiscovery'").fetchone()
        state=json.loads(row[0]) if row else None
        if not state or state['complete'] or state.get('days')!=days:state={'skip':0,'until':now,'since':since,'complete':False,'days':days,'signature':None,'phase':'recent'}
        pages=0
        while not state['complete'] and pages<20 and client.attempts<client.max_requests-2:
            params={'organizationId':org,'ChatState':'Open' if state.get('phase')=='open' else 'All','ContactTypes':'DirectMessage','Include':'MemberTimelines','IncludePinneds':'false','Compact':'false','ChatOrderBy':'CreatedAtUTC','Order':'Desc','DateEndCreatedAtUTC':state['until'],'Skip':state['skip'],'Take':50,'Behavior':'GetSliceOnly'}
            if state.get('phase')!='open':params['DateStartCreatedAtUTC']=state['since']
            response=client.get('/v1/chats/',params)
            items=response.get('items')
            if not isinstance(items,list):raise c.CollectorError('Listagem inválida.')
            signature=','.join(sorted(c.valid_id(i['id'],'chat') for i in items))
            if items and signature==state.get('signature'):raise c.CollectorError('Página repetida; cursor preservado.')
            with db:
                for item in items:
                    channel=item.get('channel') or {}
                    if 'Whatsapp' not in channel.get('_t',''):continue
                    db.execute('INSERT INTO service_chats VALUES (?,?,?,?) ON CONFLICT(organization_id,id) DO UPDATE SET raw_json=excluded.raw_json,observed_at=excluded.observed_at',(org,item['id'],c.json_text(item),now))
                    # Also make these real chats available in the existing conversational reader.
                    db.execute('INSERT INTO chats VALUES (?,?,?,?) ON CONFLICT(organization_id,id) DO UPDATE SET raw_json=excluded.raw_json,channel_id=excluded.channel_id',(org,item['id'],channel.get('id'),c.json_text(item)))
                if not items and state.get('phase')!='open':state.update(skip=0,signature=None,phase='open')
                else:state.update(skip=state['skip']+len(items),signature=signature,complete=not items)
                sync.meta(db,'attendanceDiscovery',state)
            pages+=1
        progress('running')
        # Oldest checked chats first; unfinished pages retain their cursor across runs.
        candidates=db.execute('''SELECT c.id,c.raw_json,p.cursor,p.until_utc,p.from_utc,p.complete,p.limited FROM service_chats c LEFT JOIN service_progress p ON p.organization_id=c.organization_id AND p.chat_id=c.id WHERE c.organization_id=? ORDER BY CASE WHEN p.complete=0 THEN 0 WHEN p.chat_id IS NULL THEN 1 ELSE 2 END,p.until_utc,json_extract(c.raw_json,'$.createdAtUTC') DESC,c.id''',(org,)).fetchall()
        for row in candidates:
            raw=json.loads(row['raw_json']);last=(raw.get('lastMessage') or {}).get('eventAtUTC') or raw.get('eventAtUTC') or now
            if row['complete'] and row['until_utc']>=last:continue
            cursor=row['cursor'] if row['cursor'] and not row['complete'] else now
            upper=row['until_utc'] if row['cursor'] and not row['complete'] else now
            lower=row['from_utc'] if row['cursor'] and not row['complete'] else (row['until_utc'] if row['complete'] else since)
            for _ in range(30):
                response=client.get('/v1/chats/'+c.valid_id(row['id'],'chat')+'/relative-messages/',{'organizationId':org,'FromEventUTC':cursor,'Take':250,'Direction':'TakeBefore','IncludeMetadata':'true'})
                entries=response.get('messages',[])
                oldest=min((c.iso_utc(c.parse_utc(e['eventAtUTC'])) for e in entries),default=cursor)
                if entries and oldest>=cursor:raise c.CollectorError('Cursor de eventos sem avanço.')
                complete=len(entries)<250 or oldest<lower
                limited=bool(response.get('hasMessagesBeforeAllowedOrganizationPlan'))
                with db:
                    save_page(db,org,row['id'],response)
                    # One-millisecond overlap prevents losing events at a page boundary.
                    next_cursor=c.iso_utc(c.parse_utc(oldest)+timedelta(milliseconds=1)) if entries else cursor
                    if entries and next_cursor>=cursor and not complete:raise c.CollectorError('Página sem desempate temporal; cobertura permanece parcial.')
                    db.execute('INSERT INTO service_progress VALUES (?,?,?,?,?,?,?) ON CONFLICT(organization_id,chat_id) DO UPDATE SET cursor=excluded.cursor,until_utc=excluded.until_utc,from_utc=excluded.from_utc,complete=excluded.complete,limited=excluded.limited',(org,row['id'],next_cursor,upper,lower,int(complete),int(limited)))
                    if entries or (complete and not limited):
                        coverage_start=lower if complete and not limited else oldest
                        db.execute('INSERT INTO service_coverage VALUES (?,?,?,?) ON CONFLICT(organization_id,chat_id,start_utc) DO UPDATE SET end_utc=max(end_utc,excluded.end_utc)',(org,row['id'],coverage_start,cursor))
                cursor=next_cursor
                if complete:break
            progress('running')
        # Ratings are optional; do not collapse a missing/forbidden resource to zero.
        ratings=client.get('/v1/contact-ratings/',{'organizationId':org,'startUTC':since,'endUTC':now,'Take':50,'Skip':0,'Behavior':'GetSliceOnly'})
        with db:
            for r in ratings.get('items',[]):db.execute('INSERT INTO service_ratings VALUES (?,?,?) ON CONFLICT(organization_id,id) DO UPDATE SET raw_json=excluded.raw_json',(org,r['id'],c.json_text(r)))
            sync.meta(db,'attendanceRatings',{'checkedAt':now,'partial':len(ratings.get('items',[]))>=50})
        unfinished=db.execute('SELECT count(*) FROM service_chats c LEFT JOIN service_progress p ON p.organization_id=c.organization_id AND p.chat_id=c.id WHERE c.organization_id=? AND (p.chat_id IS NULL OR p.complete=0)',(org,)).fetchone()[0]
        progress('complete' if state['complete'] and not unfinished else 'partial')
    except c.BudgetExhausted:
        progress('partial')
    except Exception:
        progress('error');raise

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--days',type=int,default=90);parser.add_argument('--max-requests',type=int,default=150);args=parser.parse_args()
    if not 1<=args.days<=366:parser.error('Período deve ter até 366 dias.')
    with c.single_process_lock(sync.DB),closing(c.connect_db(sync.DB)) as db:
        sync.schema(db);schema(db)
        org=json.loads(db.execute("SELECT value FROM crm_meta WHERE key='organizationId'").fetchone()[0])
        with c.single_process_lock(c.runtime_state_path()):
            client=c.TalkClient(os.environ.get('UTALK_API_TOKEN',''),interval=3,max_requests=args.max_requests,state_path=c.runtime_state_path())
            try:run(db,client,org,args.days)
            finally:sync.publish(db)
    print('Coleta de atendimento concluída; consulte a cobertura no painel.')

if __name__=='__main__':
    try:main()
    except (c.CollectorError,OSError) as e:
        print('Coleta interrompida. Registros confirmados e cursor foram preservados.')
        if isinstance(e,c.CollectorError): print(str(e))
        raise SystemExit(1)
