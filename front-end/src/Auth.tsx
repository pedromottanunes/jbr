import {createContext,useContext,useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {useQuery,useQueryClient,type QueryClient} from '@tanstack/react-query';
import {ArrowRight,ChartNoAxesCombined,ContactRound,Eye,EyeOff,Headset,LogOut,LockKeyhole,UserRound} from 'lucide-react';
import {getJson,sendJson} from './api';
import './auth.css';

type Session={required:boolean;authenticated:boolean;username?:string};
function replaceSession(client:QueryClient,session:Session){
 void client.cancelQueries();
 client.removeQueries({predicate:query=>query.queryKey[0]!=='auth-session'});
 client.setQueryData<Session>(['auth-session'],session);
}
const AuthContext=createContext<{required:boolean;logout:()=>Promise<void>}>({required:false,logout:async()=>{}});
export function SessionControl(){
 const {required,logout}=useContext(AuthContext);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!required)return <><span className="status-dot"/> Ambiente local</>;
 return <div className="session-control"><span><span className="status-dot"/> Conectado</span><button onClick={async()=>{setBusy(true);setError('');try{await logout();}catch{setError('Não foi possível sair. Tente novamente.');}finally{setBusy(false);}}} disabled={busy} title="Sair do CRM" aria-label="Sair do CRM"><LogOut size={17}/></button>{error&&<small role="alert">{error}</small>}</div>;
}
export function AuthGate({children}:{children:ReactNode}){
 const client=useQueryClient();
 const session=useQuery({queryKey:['auth-session'],queryFn:({signal})=>getJson<Session>('/auth/session',signal),retry:false,refetchOnWindowFocus:true,refetchInterval:300_000});
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [showPassword,setShowPassword]=useState(false);
 useEffect(()=>{
  const expired=()=>{replaceSession(client,{required:true,authenticated:false});setPassword('');setShowPassword(false);setError('Sua sessão terminou. Entre novamente.');};
  window.addEventListener('crm-session-expired',expired);
  return ()=>window.removeEventListener('crm-session-expired',expired);
 },[client]);
 const logout=async()=>{await sendJson('/auth/logout','POST',{});replaceSession(client,{required:true,authenticated:false});setPassword('');setShowPassword(false);setError('');};
 if(session.isPending)return <div className="state">Abrindo CRM…</div>;
 if(session.error)return <div className="state error"><p>Não foi possível conectar ao CRM.</p><button onClick={()=>session.refetch()}>Tentar novamente</button></div>;
 if(session.data?.authenticated)return <AuthContext.Provider value={{required:session.data.required,logout}}>{children}</AuthContext.Provider>;
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try{const result=await sendJson<Session>('/auth/login','POST',{username,password});replaceSession(client,result);setPassword('');setShowPassword(false);}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível entrar.');}finally{setBusy(false);}
 };
 return <main className="login-page">
  <img className="login-scene" src="/login-jbr-road.webp" alt="" aria-hidden="true"/>
  <div className="login-layout">
   <section className="login-intro" aria-labelledby="login-headline">
    <div className="login-brand"><img src="/jbr-logo-white.webp" alt="Grupo JBR Brasil" width="640" height="200"/><span className="login-brand-label">CRM<span>Central comercial</span></span></div>
    <div className="login-pitch"><p className="login-eyebrow"><span/> CONEXÕES QUE MOVEM RESULTADOS</p>
     <h1 id="login-headline">Cada contato.<br/>Uma nova<br/><em>oportunidade.</em></h1>
     <p className="login-description">Campanhas, leads e atendimento conectados<br className="login-desktop-break"/> para a JBR ir mais longe.</p>
     <ul className="login-features" aria-label="Recursos do CRM"><li><ChartNoAxesCombined size={17} aria-hidden="true"/>Tráfego pago</li><li><ContactRound size={17} aria-hidden="true"/>Gestão de leads</li><li><Headset size={17} aria-hidden="true"/>Atendimento</li></ul>
    </div>
   </section>
   <div className="login-access">
    <section className="login-card" aria-labelledby="login-title">
     <header className="login-card-header"><span className="login-card-kicker">BEM-VINDO AO CRM JBR</span><h2 id="login-title">Acesse sua conta</h2><p>Sua central de resultados começa aqui.</p></header>
     <form onSubmit={submit} aria-busy={busy}>
      <div className="login-field"><label htmlFor="login-user">Usuário</label><div className="login-input-wrap"><UserRound size={19} aria-hidden="true"/><input id="login-user" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Digite seu usuário" value={username} onChange={e=>setUsername(e.target.value)} maxLength={80} aria-describedby={error?'login-error':undefined} required/></div></div>
      <div className="login-field"><label htmlFor="login-password">Senha</label><div className="login-input-wrap"><LockKeyhole size={18} aria-hidden="true"/><input id="login-password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Digite sua senha" value={password} onChange={e=>setPassword(e.target.value)} maxLength={256} aria-describedby={error?'login-error':undefined} required/><button className="login-password-toggle" type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'} aria-pressed={showPassword} aria-controls="login-password">{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></div>
      {error&&<p id="login-error" className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={busy} type="submit"><span>{busy?'Entrando…':'Entrar no CRM'}</span><ArrowRight size={20} aria-hidden="true"/></button>
     </form>
     <div className="login-card-foot"><span className="login-brand-colors" aria-hidden="true"><i/><i/><i/></span><span>Grupo JBR Brasil</span></div>
    </section>
    <p className="login-access-note"><LockKeyhole size={13} aria-hidden="true"/>Acesso exclusivo à equipe JBR.</p>
   </div>
  </div>
  <footer className="login-footer"><span>GRUPO JBR BRASIL</span><span><a href="/privacidade.html">Privacidade</a> · <a href="/exclusao-de-dados.html">Exclusão de dados</a></span></footer>
 </main>;
}
