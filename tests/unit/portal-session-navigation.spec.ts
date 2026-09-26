import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the shipped UI script with a small DOM/HTTP fixture. No real accounts or providers.
const script=readFileSync('src/portal/ui/portal.js','utf8');
function portal(entries=['/login'], role: 'CLIENT'|'ADMIN'|null=null) {
  const events:Record<string,Function>={},painted:string[]=[],calls:string[]=[];
  let html='',nodes:Record<string,any>={},index=entries.length-1,current=role;
  let sessionError=0;
  const location={pathname:entries[index],hash:''};
  const element=(id:string)=>nodes[id]??=(id==='#auth-form'?{querySelector:()=>element('#auth-button')}:{value:'',textContent:'',className:'',append(){},insertAdjacentElement(){},parentElement:{classList:{add(){}}},setAttribute(){},focus(){}});
  const root={get innerHTML(){return html},set innerHTML(value:string){html=value;nodes={};painted.push(value)}};
  const document={
    createElement:()=>({setAttribute(){},focus(){}}),
    querySelector:(selector:string)=>selector==='#root'?root:element(selector),
    querySelectorAll:(selector:string)=>selector==='.logout'&&html.includes('class="logout')?[element('.logout')]:selector==='[data-route]'?[...html.matchAll(/href="([^"]+)" data-route/g)].map(m=>({getAttribute:()=>m[1]})):[]
  };
  const session=()=>({user:{name:'Test Owner',role:current},csrf:'test-csrf'});
  const fetch=async(url:string)=>{
    calls.push(url);let status=200,data:any={};
    if(url==='/api/auth/session'){status=sessionError||(current?200:401);data=current?session():{};}
    else if(url==='/api/auth/signup')data={redirect:'/login',message:'Your account is ready. Log in to continue.'};
    else if(url==='/api/auth/login'){current='CLIENT';data={...session(),redirect:'/app'};}
    else if(url==='/api/auth/logout')current=null;
    else if(url==='/api/portal/plans')data={plans:[]};
    else if(url==='/api/portal/settings')data={emailVerificationSkipped:true};
    else if(url==='/api/client/profile')data={profile:{draft:{name:'Test',description:'Test business'},status:'DRAFT',plan:null}};
    else if(url==='/api/client/dashboard')data={profile:{draft:{name:'Test',description:'Test business'},status:'DRAFT',plan:null,publishedRevision:0},connections:[],metrics:{totals:{},daily:[],usage:{}},documents:{total:0,ready:0,pending:0},recentConversations:[]};
    else if(url==='/api/client/whatsapp')data={connections:[]};
    else if(url==='/api/admin/overview')data={counts:[],usage:{},activity:[]};
    else throw Error('Unexpected request: '+url);
    return {ok:status<400,status,json:async()=>data};
  };
  const history={
    replaceState:(_a:any,_b:any,path:string)=>{entries[index]=path;location.pathname=path;},
    pushState:(_a:any,_b:any,path:string)=>{entries.splice(++index);entries.push(path);location.pathname=path;}
  };
  runInNewContext(script,{window:{addEventListener:(name:string,fn:Function)=>events[name]=fn},document,location,history,fetch,URLSearchParams,FormData,clearTimeout,setTimeout:()=>0,confirm:()=>true});
  return {
    root,painted,calls,entries,location,element,
    start:()=>events.DOMContentLoaded(),
    visit:async(path:string)=>{history.pushState({},'',path);await events.popstate();},
    back:async()=>{location.pathname=entries[--index];await events.popstate();},
    forward:async()=>{location.pathname=entries[++index];await events.popstate();},
    restore:async()=>{events.pageshow({persisted:true});await new Promise(r=>setImmediate(r));},
    expire:()=>current=null,
    failSession:()=>sessionError=503,
    submit:async()=>element('#auth-form').onsubmit({preventDefault(){},target:element('#auth-form')})
  };
}

describe('portal session navigation',()=>{
  it('requires a separate login after signup and replaces authentication history',async()=>{
    const p=portal(['/signup']);await p.start();
    expect(p.root.innerHTML).not.toContain('id="plan"');
    expect(p.root.innerHTML).toContain('administrator will assign your plan afterward');
    p.element('#name').value='Test';p.element('#email').value='owner@test.example';p.element('#password').value='Test-password-2026!';
    await p.submit();expect(p.location.pathname).toBe('/login');expect(p.entries).toEqual(['/login']);
    expect(p.root.innerHTML).toContain('Welcome back');expect(p.element('#auth-notice').textContent).toContain('Log in to continue');
    expect(p.calls).not.toContain('/api/client/profile');
    p.element('#email').value='owner@test.example';p.element('#password').value='Test-password-2026!';
    await p.submit();expect(p.entries).toEqual(['/app']);expect(p.root.innerHTML).toContain('Let’s get you live, Test');
  });
  it.each(['CLIENT','ADMIN'] as const)('keeps signed-in %s users out of login/register, including Back and Forward',async(role)=>{
    const home=role==='ADMIN'?'/admin':'/app';
    const p=portal(['/signup','/login',home],role);await p.start();
    await p.back();expect(p.location.pathname).toBe(home);await p.back();expect(p.location.pathname).toBe(home);
    await p.forward();expect(p.location.pathname).toBe(home);expect(p.entries).toHaveLength(3);
    await p.visit('/signup');expect(p.location.pathname).toBe(home);
    expect(p.painted.every(page=>!page.includes('id="auth-form"'))).toBe(true);
  });
  it('allows signed-out users to navigate between signup and login',async()=>{
    const p=portal(['/signup','/login']);await p.start();await p.back();
    expect(p.location.pathname).toBe('/signup');expect(p.root.innerHTML).toContain('Create your workspace');
    await p.forward();expect(p.root.innerHTML).toContain('Welcome back');
  });
  it('rechecks the server session on history navigation and cached-page restoration',async()=>{
    const p=portal(['/app','/app'],'CLIENT');await p.start();p.expire();await p.back();
    expect(p.location.pathname).toBe('/login');expect(p.root.innerHTML).toContain('Welcome back');
    const cached=portal(['/app'],'CLIENT');await cached.start();cached.expire();await cached.restore();
    expect(cached.location.pathname).toBe('/login');expect(cached.root.innerHTML).toContain('Welcome back');
  });
  it('does not restore the dashboard when Back is pressed after logout',async()=>{
    const p=portal(['/app','/app'],'CLIENT');await p.start();await p.element('.logout').onclick();
    expect(p.location.pathname).toBe('/login');await p.back();expect(p.location.pathname).toBe('/login');
    expect(p.root.innerHTML).toContain('Welcome back');expect(p.entries).toHaveLength(2);
  });
  it('shows a retry screen on a server error rather than assuming the session ended',async()=>{
    const p=portal(['/login'],'CLIENT');p.failSession();await p.start();
    expect(p.root.innerHTML).toContain('Try again');expect(p.root.innerHTML).not.toContain('id="auth-form"');
  });
});
