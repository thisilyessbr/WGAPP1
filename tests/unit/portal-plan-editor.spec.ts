import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

describe('plan editor presets', () => {
  it('creates an unpublished commerce offer with distinct customer and AI limits', async () => {
    const dom = new JSDOM('<div id="root"></div>', {url:'https://app.relayqo.online/admin/plans',runScripts:'outside-only'});
    dom.window.eval(readFileSync('src/portal/ui/plans.js','utf8'));
    const root = dom.window.document.querySelector('#root')!;
    let saved: any;
    await (dom.window as any).RelayqoPlans.renderAdmin({root,
      shell:(html: string) => html, header:(title: string, _text: string, actions = '') => `<h1>${title}</h1>${actions}`,
      escape:(value: unknown) => String(value), toast:() => {}, bind:() => {}, go:() => {},
      api:async (path: string, options?: any) => {
        if(path === '/admin/plans' && !options)return {plans:[]};
        saved = JSON.parse(options.body);return {plan:{id:'saved'}};
      }
    });
    (root.querySelector('#new-plan') as HTMLButtonElement).click();
    const preset = root.querySelector('#plan-preset') as HTMLSelectElement;
    preset.value = 'commerce';
    preset.dispatchEvent(new dom.window.Event('change'));
    expect((root.querySelector('#plan-price') as HTMLInputElement).value).toBe('649');
    expect((root.querySelector('[data-module="commerce"]') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('[data-module="qr"]') as HTMLInputElement).checked).toBe(false);
    await (root.querySelector('#plan-form') as any).onsubmit({preventDefault() {}});
    expect(saved.published).toBe(false);
    expect(saved.limits.monthlyUsd).toBeGreaterThan(0);
    expect(saved.limits.messages).toBeGreaterThan(saved.limits.llmCalls);
    dom.window.close();
  });
  it('shows client-facing features without exposing internal AI budgets', async () => {
    const dom = new JSDOM('<div id="root"></div>', {url:'https://app.relayqo.online/app/plans',runScripts:'outside-only'});
    dom.window.eval(readFileSync('src/portal/ui/plans.js','utf8'));
    const root = dom.window.document.querySelector('#root')!;
    await (dom.window as any).RelayqoPlans.renderClient({root,shell:(html:string)=>html,
      header:(title:string)=>`<h1>${title}</h1>`,escape:(value:unknown)=>String(value),toast:()=>{},bind:()=>{},
      api:async (path:string)=>path==='/portal/plans' ? {plans:[{id:'one',name:'Commerce',description:'Shop',price:649,currency:'MAD',modules:['commerce','images']}]} : {profile:{plan:null}}
    });
    expect(root.textContent).toContain('Product catalog');
    expect(root.textContent).toContain('Lead follow-up and CSV export');
    expect(root.textContent).not.toContain('AI spend ceiling');
    expect(root.textContent).not.toContain('llmCalls');
    dom.window.close();
  });
});
