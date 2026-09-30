import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

describe('administrator account sections', () => {
  it('shows each admin control in exactly one relevant panel', () => {
    const dom = new JSDOM(`<!doctype html><main class="content">
      <div class="tabs"></div><div class="grid-2" id="overview"></div>
      <article id="editing-freeze"><button>Freeze editing</button></article>
      <div id="everyday-settings"><input id="control-behavior-stayOnTopic"></div>
      <article id="admin-qr-connection"></article>
      <article id="admin-voice-notes-card"></article>
      <article id="admin-instagram-card"></article>
      <article id="client-owned-meta"></article>
      <article id="technical"><textarea id="config"></textarea></article>
      <article id="usage"></article><article><div id="documents-list"></div></article>
      <article><div id="conversation-list"></div></article>
      <article><form id="preview-form"></form></article><article id="history"></article>
    </main>`, { url: 'https://app.relayqo.online/admin/client/example', runScripts: 'outside-only' });
    dom.window.eval(readFileSync('src/portal/ui/design.js', 'utf8'));
    (dom.window as any).RelayqoDesign.decorate();
    const { document } = dom.window;
    const panel = (id: string) => document.querySelector(id)?.closest('[role="tabpanel"]');
    expect(panel('#editing-freeze')).toBe(panel('#overview'));
    expect(panel('#everyday-settings')).not.toBe(panel('#technical'));
    for (const id of ['#admin-qr-connection', '#admin-voice-notes-card', '#admin-instagram-card', '#client-owned-meta']) {
      expect(panel(id)).toBe(panel('#admin-qr-connection'));
      expect(document.querySelectorAll(id)).toHaveLength(1);
    }
    expect(panel('#admin-qr-connection')).not.toBe(panel('#technical'));
    const chatbotTab = [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'Chatbot & limits') as HTMLButtonElement;
    chatbotTab.click();
    expect(panel('#everyday-settings')?.hidden).toBe(false);
    expect(panel('#technical')?.hidden).toBe(true);
    expect(panel('#admin-voice-notes-card')?.hidden).toBe(true);
    const channelsTab = [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'Channels') as HTMLButtonElement;
    channelsTab.click();
    expect(panel('#admin-voice-notes-card')?.hidden).toBe(false);
    expect(panel('#overview')?.hidden).toBe(true);
    dom.window.close();
  });
});
