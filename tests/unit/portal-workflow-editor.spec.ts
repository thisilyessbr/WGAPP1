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
  it.each(['blank','triage','lead','cod','feedback'])('creates a valid %s template that the backend accepts',kind=>{
    const workflow=template(kind,'test');
    expect(diagnostics({test:workflow},[]).errors).toEqual([]);
    expect(()=>validateAdminConfig({workflows:{test:workflow}})).not.toThrow();
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
});
