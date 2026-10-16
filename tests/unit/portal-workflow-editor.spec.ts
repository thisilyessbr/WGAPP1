import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { validateAdminConfig } from '../../src/portal/validation';

const scope:any={window:{}};
runInNewContext(readFileSync('src/portal/ui/workflows.js','utf8'),scope);
const {template,diagnostics,renameState,orderedSteps,removeIntent}=scope.window.RelayqoWorkflows;
describe('portal visual workflows',()=>{
  it('displays steps from the start after database key reordering, including loops and disconnected steps',()=>{
    const wf=template('lead','test');
    wf.states=Object.fromEntries(Object.entries(wf.states).sort(([a],[b])=>a.localeCompare(b)));
    expect(orderedSteps(wf)).toEqual(['start','phone','confirm','done']);
    wf.states.phone.next='start';
    expect(orderedSteps(wf)).toEqual(['start','phone','confirm','done']);
  });
  it('keeps conditional intent routes intact when deletion would break them',()=>{
    const wf=template('lead','test');wf.activation.intents=['CONTACT'];wf.states.confirm.transitions[0].intent='CONTACT';
    const intents=[{id:'CONTACT'}];
    expect(()=>removeIntent({test:wf},intents,0)).toThrow('conditional transitions');
    expect(intents).toEqual([{id:'CONTACT'}]);expect(wf.activation.intents).toEqual(['CONTACT']);
    delete wf.states.confirm.transitions[0].intent;
    removeIntent({test:wf},intents,0);
    expect(intents).toEqual([]);expect(wf.activation.intents).toEqual([]);
  });
  it.each(['blank','triage','lead','cod','feedback','sales'])('creates a valid %s template that the backend accepts',kind=>{
    const workflow=template(kind,'test');
    expect(diagnostics({test:workflow},[]).errors).toEqual([]);
    expect(()=>validateAdminConfig({workflows:{test:workflow}})).not.toThrow();
  });
  it('requires one explicit workflow per shared customer use case',()=>{
    const demo=template('lead','demo');
    const support=template('lead','support');
    const config:any={workflows:{demo,support},capabilities:{intents:[{id:'DEMO',workflowId:'demo',useCases:['PURCHASE']}]}};
    expect(()=>validateAdminConfig(config)).not.toThrow();
    config.capabilities.intents[0].workflowId='missing';
    expect(()=>validateAdminConfig(config)).toThrow('Link each shared use case');
    config.capabilities.intents[0].workflowId='demo';
    config.capabilities.intents.push({id:'SUPPORT',workflowId:'support',useCases:['PURCHASE']});
    expect(()=>validateAdminConfig(config)).toThrow('One shared use case');
  });
  it('rejects two auto-start workflows rather than depending on JSON order',()=>{
    const first=template('lead','first');
    const second=template('lead','second');
    first.activation.mode='auto_start';
    second.activation.mode='auto_start';
    expect(()=>validateAdminConfig({workflows:{first,second}})).toThrow('CONFLICTING_AUTO_START_WORKFLOWS');
  });
  it('captures the fields needed for a cash-on-delivery ticket before confirmation',()=>{
    const workflow=template('cod','checkout_test');
    expect(orderedSteps(workflow)).toEqual(['start','quantity','customer_name','phone','city','address','confirm','done']);
    expect(['product','quantity','customer_name','phone','city','address']).toEqual(
      orderedSteps(workflow).filter((key:string)=>workflow.states[key].type==='collect').map((key:string)=>workflow.states[key].field.name));
    expect(workflow.activation.intents).toEqual(['BUY_INTENT']);
    expect(workflow.states.done.prompt.en).toContain('contact you to confirm');
  });
  it('renames steps without breaking branching, linear, conditional or initial references',()=>{
    const wf=template('lead','test');wf.states.start.options=[{label:'Go',next:'phone'}];wf.states.start.transitions=[{condition:'ready',intent:'CONTACT',target:'phone'}];wf.initialState='phone';
    renameState(wf,'phone','mobile');
    expect(wf.states.phone).toBeUndefined();expect(wf.states.mobile.field.type).toBe('phone');expect(wf.initialState).toBe('mobile');
    expect(wf.states.start.next).toBe('mobile');expect(wf.states.start.options[0].next).toBe('mobile');expect(wf.states.start.transitions[0]).toEqual({condition:'ready',intent:'CONTACT',target:'mobile'});
    expect(wf.states.start.prompt.darija).toBe('Chno smitek?');
  });
  it('rejects conflicting or unsafe step IDs without changing data',()=>{
    const wf=template('lead','test'),before=JSON.stringify(wf);
    for(const id of ['done','__proto__','constructor','bad id'])expect(()=>renameState(wf,'phone',id)).toThrow();
    expect(JSON.stringify(wf)).toBe(before);
  });
  it('identifies broken graph targets, missing fields, intent links and unreachable states',()=>{
    const wf=template('lead','test');wf.states.start.next='missing';wf.states.phone.field.name='';
    const result=diagnostics({test:wf},[{id:'BUY',workflowId:'missing'}]);
    expect(result.errors.join(' ')).toContain('missing step');expect(result.errors.join(' ')).toContain('data field');expect(result.errors.join(' ')).toContain('linked workflow');expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('allows intentional loops and reports duplicate collected fields without discarding them',()=>{
    const wf=template('lead','test');wf.states.phone.next='start';wf.states.phone.field.name='fullName';
    const result=diagnostics({test:wf});expect(result.errors).toEqual([]);expect(result.warnings.join(' ')).toContain('collected more than once');
  });
  it('builds the sales template as discovery questions, a pitch, a calendar day and time, then an email',()=>{
    const wf=template('sales','sales_test');
    expect(orderedSteps(wf)).toEqual(['start','business','channels','problem','volume','demo_day','demo_time','email','done']);
    expect(['business','channels','problem','volume'].every(id=>wf.states[id].field.acceptAnyReply)).toBe(true);
    expect(wf.states.demo_day).toMatchObject({calendar:'day',pitch:true,next:'demo_time'});
    expect(wf.states.demo_time.calendar).toBe('slots');
    expect(wf.calendarBooking).toBe(true);
    expect(wf.states.done.prompt.darija).not.toContain('تأكد الموعد');
    expect(diagnostics({s:wf},[],{enabled:true,calendarId:'team@example.com'}).warnings).toEqual([]);
    expect(()=>validateAdminConfig({workflows:{s:wf},calendar:{enabled:true,calendarId:'team@example.com',slotTimes:['10:00','14:00'],workingDays:[1,2,3,4,5]}})).not.toThrow();
  });
  it('flags calendar steps that cannot work',()=>{
    const wf=template('sales','sales_test');
    expect(diagnostics({s:wf},[],{}).warnings.join(' ')).toContain('calendar bookings are paused');
    wf.states.volume.next='demo_time';wf.states.demo_day.next='email';
    const errors=diagnostics({s:wf},[],{enabled:true,calendarId:'x'}).errors.join(' ');
    expect(errors).toContain('must come right after a calendar day step');
    expect(errors).toContain('must be a calendar time step');
    delete wf.states.demo_day.calendar;delete wf.states.demo_time.calendar;
    expect(diagnostics({s:wf},[],{}).warnings.join(' ')).toContain('no step offers calendar times');
  });
});
