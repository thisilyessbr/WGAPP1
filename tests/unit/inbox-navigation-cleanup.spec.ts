import {describe,it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';

describe('inbox navigation cleanup',()=>{
  it('does not restart background polling when an abandoned page finishes loading',async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:'https://app.relayqo.online/app/inbox',runScripts:'outside-only'});
    const polling=vi.fn(()=>1);dom.window.setInterval=polling as any;
    dom.window.eval(readFileSync('src/portal/ui/inbox.js','utf8'));
    const inbox=(dom.window as any).RelayqoInbox;
    let reject!:(reason:Error)=>void;
    const response=new Promise((_resolve,rejectRequest)=>reject=rejectRequest);
    const pending=inbox.renderInbox({root:dom.window.document.querySelector('#root'),shell:(html:string)=>html,escape:(s:string)=>s,api:()=>response,bind:()=>{},toast:()=>{},go:()=>{},path:'/app/inbox'});
    inbox.cleanup();
    reject(new Error('Navigation cancelled'));await pending;
    expect(polling).not.toHaveBeenCalled();
    dom.window.close();
  });
});
