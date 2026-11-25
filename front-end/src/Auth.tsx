import {createContext,useContext,useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {useQuery,useQueryClient,type QueryClient} from '@tanstack/react-query';
import {ArrowRight,LogOut,LockKeyhole} from 'lucide-react';
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
 useEffect(()=>{
  const expired=()=>{replaceSession(client,{required:true,authenticated:false});setPassword('');setError('Sua sessão terminou. Entre novamente.');};
  window.addEventListener('crm-session-expired',expired);
  return ()=>window.removeEventListener('crm-session-expired',expired);
 },[client]);
 const logout=async()=>{await sendJson('/auth/logout','POST',{});replaceSession(client,{required:true,authenticated:false});setPassword('');setError('');};
 if(session.isPending)return <div className="state">Abrindo CRM…</div>;
 if(session.error)return <div className="state error"><p>Não foi possível conectar ao CRM.</p><button onClick={()=>session.refetch()}>Tentar novamente</button></div>;
 if(session.data?.authenticated)return <AuthContext.Provider value={{required:session.data.required,logout}}>{children}</AuthContext.Provider>;
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try{const result=await sendJson<Session>('/auth/login','POST',{username,password});replaceSession(client,result);setPassword('');}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível entrar.');}finally{setBusy(false);}
 };
 return <main className="login-page"><section className="login-card"><div className="login-brand"><img src="/jbr-logo-white.webp" alt="Grupo JBR Brasil"/><span>CRM JBR</span></div><form onSubmit={submit}><div className="login-title"><LockKeyhole size={20}/><h1>Entrar no CRM</h1></div><label htmlFor="login-user">Usuário</label><input id="login-user" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={80} required autoFocus/><label htmlFor="login-password">Senha</label><input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={256} required/>{error&&<p className="login-error" role="alert">{error}</p>}<button className="login-submit" disabled={busy} type="submit">{busy?'Entrando…':'Entrar'}<ArrowRight size={18}/></button></form></section></main>;
}
