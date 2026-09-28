import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the shipped UI script with a small DOM/HTTP fixture. No real accounts or providers.
const script=readFileSync('src/portal/ui/portal.js','utf8');
function portal(entries=['/login'], role: 'CLIENT'|'ADMIN'|null=null, modules:string[]=[] ) {
  const events:Record<string,Function>={},painted:string[]=[],calls:string[]=[];
  let html='',nodes:Record<string,any>={},links:any[]=[],index=entries.length-1,current=role;
  let sessionError=0,clientError=0,clock=Date.now();
  const delays=new Map<string,Promise<void>>();
  const location={pathname:entries[index],hash:''};
  const element=(id:string)=>nodes[id]??=(id==='#auth-form'?{querySelector:()=>element('#auth-button')}:{value:'',textContent:'',className:'',append(){},addEventListener(){},insertAdjacentElement(){},parentElement:{classList:{add(){}}},setAttribute(){},focus(){}});
  const root={querySelector:element,querySelectorAll:()=>[],get innerHTML(){return html},set innerHTML(value:string){html=value;nodes={};links=[...html.matchAll(/href="([^"]+)" data-route/g)].map(m=>({getAttribute:()=>m[1]}));painted.push(value)}};
  const document={
    addEventListener(){},
    createElement:()=>({setAttribute(){},focus(){}}),
    querySelector:(selector:string)=>selector==='#root'?root:element(selector),
    querySelectorAll:(selector:string)=>selector==='.logout'&&html.includes('class="logout')?[element('.logout')]:selector.startsWith('[data-route]')?links:[]
  };
  const session=()=>({user:{name:'Test Owner',role:current},csrf:'test-csrf'});
  const fetch=async(url:string)=>{
    calls.push(url);await delays.get(url);let status=200,data:any={};
    if(url.startsWith('/api/client/')&&clientError){status=clientError;}
    else if(url==='/api/auth/session'){status=sessionError||(current?200:401);data=current?session():{};}
    else if(url==='/api/auth/signup')data={redirect:'/login',message:'Your account is ready. Log in to continue.'};
    else if(url==='/api/auth/login'){current='CLIENT';data={...session(),redirect:'/app'};}
    else if(url==='/api/auth/logout')current=null;
    else if(url==='/api/portal/plans')data={plans:[]};
    else if(url==='/api/portal/settings')data={emailVerificationSkipped:true};
    else if(url==='/api/client/profile')data={profile:{draft:{name:'Test',description:'Test business'},status:'DRAFT',plan:{modules}}};
    else if(url==='/api/client/dashboard')data={profile:{draft:{name:'Test',description:'Test business'},status:'DRAFT',plan:{modules},publishedRevision:0},connections:[],metrics:{totals:{},daily:[],usage:{}},documents:{total:0,ready:0,pending:0},recentConversations:[]};
    else if(url==='/api/client/whatsapp')data={connections:[]};
    else if(url==='/api/admin/overview')data={counts:[],usage:{},activity:[]};
    else throw Error('Unexpected request: '+url);
    return {ok:status<400,status,json:async()=>data};
  };
  const history={
    replaceState:(_a:any,_b:any,path:string)=>{entries[index]=path;location.pathname=path;},
    pushState:(_a:any,_b:any,path:string)=>{entries.splice(++index);entries.push(path);location.pathname=path;}
  };
  class FixtureDate extends Date {static now(){return clock;}}
  runInNewContext(script,{window:{addEventListener:(name:string,fn:Function)=>events[name]=fn},document,location,history,fetch,URLSearchParams,FormData,AbortController,DOMException,Date:FixtureDate,clearTimeout,setTimeout:()=>0,confirm:()=>true});
  return {
    root,painted,calls,entries,location,element,
    start:()=>events.DOMContentLoaded(),
    visit:async(path:string)=>{history.pushState({},'',path);await events.popstate();},
    back:async()=>{location.pathname=entries[--index];await events.popstate();},
    forward:async()=>{location.pathname=entries[++index];await events.popstate();},
    restore:async()=>{events.pageshow({persisted:true});await new Promise(r=>setImmediate(r));},
    expire:()=>current=null,
    failSession:()=>sessionError=503,
    failClient:()=>clientError=401,
    advance:(milliseconds:number)=>clock+=milliseconds,
    pause:(url:string)=>{let release!:()=>void;delays.set(url,new Promise<void>(resolve=>release=resolve));return release;},
    navigate:(path:string)=>{const link=document.querySelectorAll('[data-route]').find((a:any)=>a.getAttribute('href')===path);return link!.onclick({preventDefault(){}});},
    submit:async()=>element('#auth-form').onsubmit({preventDefault(){},target:element('#auth-form')})
  };
}

describe('portal session navigation',()=>{
  it('paints loading feedback before slow data arrives and reuses session/profile reads on internal clicks',async()=>{
    const p=portal(['/app'],'CLIENT');await p.start();
    expect(p.calls).not.toContain('/api/client/profile');
    const release=p.pause('/api/client/whatsapp');
    const navigation=p.navigate('/app/whatsapp');
    expect(p.location.pathname).toBe('/app/whatsapp');
    expect(p.root.innerHTML).toContain('page-loading');
    expect(p.root.innerHTML).toContain('data-route');
    await new Promise(r=>setImmediate(r));
    expect(p.calls.filter(url=>url==='/api/auth/session')).toHaveLength(1);
    release();await navigation;
    expect(p.root.innerHTML).toContain('Link a business number');
    expect(p.root.innerHTML).not.toContain('navigation-skeleton');
    expect(p.calls.filter(url=>url==='/api/client/profile')).toHaveLength(1);
  });
  it('does not let an older slow page overwrite the latest clicked page',async()=>{
    const p=portal(['/app'],'CLIENT');await p.start();
    const release=p.pause('/api/client/whatsapp');
    const old=p.navigate('/app/whatsapp');await new Promise(r=>setImmediate(r));
    await p.navigate('/app');
    release();await old;
    expect(p.location.pathname).toBe('/app');
    expect(p.root.innerHTML).toContain('Let’s get you live, Test');
    expect(p.root.innerHTML).not.toContain('Link a business number');
  });
  it('refreshes the session after 30 seconds even during continuous internal navigation',async()=>{
    const p=portal(['/app'],'CLIENT');await p.start();
    p.advance(20000);await p.navigate('/app/whatsapp');
    expect(p.calls.filter(url=>url==='/api/auth/session')).toHaveLength(1);
    p.advance(11000);await p.navigate('/app');
    expect(p.calls.filter(url=>url==='/api/auth/session')).toHaveLength(2);
  });
  it('honors server revocation on protected requests even while the session is reused',async()=>{
    const p=portal(['/app'],'CLIENT');await p.start();p.expire();p.failClient();
    await p.navigate('/app/whatsapp');
    expect(p.location.pathname).toBe('/login');
    expect(p.root.innerHTML).toContain('Welcome back');
  });
  it('shows Instagram in the client sidebar only when the assigned plan includes it',async()=>{
    const standard=portal(['/app'],'CLIENT');await standard.start();
    expect(standard.root.innerHTML).not.toContain('href="/app/instagram"');
    const instagram=portal(['/app'],'CLIENT',['knowledge','instagram']);await instagram.start();
    expect(instagram.root.innerHTML).toContain('href="/app/instagram"');
  });
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
