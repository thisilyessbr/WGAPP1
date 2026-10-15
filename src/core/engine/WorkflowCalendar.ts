import { WorkflowSession } from '@prisma/client';
import { BusinessConfig, WorkflowConfig, WorkflowStateConfig } from '../../domain/tenant/BusinessConfig';
import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';
import { ResponseBuilder, getWorkflowMessage } from '../../domain/conversation/ResponseBuilder';
import { LanguageDetector } from '../../domain/faq/FaqMatcher';
import { CalendarConfig, CalendarScheduler, OfferedSlot, calendarMessage, dayLabel, defaultCalendarScheduler, matchSlot, parseDay, slotList } from '../../domain/calendar/CalendarScheduler';
import { logger } from '../../utils/logger';
import type { WorkflowResult } from './WorkflowEngine';

/**
 * Calendar and sales-conversation features layered around the workflow engine:
 *  - a step with `calendar: 'day'` reads the day the customer names and offers the free slots of the business calendar;
 *  - a step with `calendar: 'slots'` takes the chosen slot (re-checking that it is still free);
 *  - a workflow with `calendarBooking: true` books the slot on completion and only then says "confirmed";
 *  - a step with `pitch` opens with a short, personalised explanation built from the customer's answers;
 *  - `{{field}}` placeholders in any step message are filled with the collected answers.
 */
export class WorkflowCalendar {
  constructor(private responseBuilder: ResponseBuilder, private scheduler?: CalendarScheduler | null) {}

  private schedulerFor(config: BusinessConfig): { scheduler: CalendarScheduler; cfg: CalendarConfig } | null {
    const cfg = (config as any).calendar as CalendarConfig | undefined;
    if (!cfg?.enabled || !cfg.calendarId) return null;
    const scheduler = this.scheduler ?? defaultCalendarScheduler();
    return scheduler ? { scheduler, cfg } : null;
  }

  private langOf(session: WorkflowSession, message: string, effectiveLang?: string, effectiveScript?: string) {
    const ctx = (session.contextData || {}) as Record<string, any>;
    const lang = effectiveLang || ctx._lang || LanguageDetector.detect(message);
    const script = lang === 'en' || lang === 'fr' ? 'latin' : lang === 'ar' ? 'arabic' : (effectiveScript || ctx._script || 'arabic');
    return { lang, script };
  }

  private statePrompt(state: WorkflowStateConfig, config: BusinessConfig, ctx: Record<string, any>, lang: string, script: string): string {
    if (state.type === 'choice') return this.responseBuilder.buildChoiceResponse(state, lang, script);
    if (state.type === 'collect') return this.responseBuilder.buildMissingFieldResponse(state, config, lang, script);
    if (state.type === 'confirm' || state.prompt === 'confirm') return this.responseBuilder.buildConfirmationResponse(ctx, config, state, lang, script);
    return this.responseBuilder.buildGenericResponse(state, config, lang, script);
  }

  /** Handles a reply on a calendar step; null lets the normal engine handle it (questions, cancellation, no calendar). */
  async before(session: WorkflowSession, message: string, workflow: WorkflowConfig, config: BusinessConfig,
    effectiveLang?: string, effectiveScript?: string, isCancellation?: (m: string) => boolean): Promise<WorkflowResult | null> {
    const state = workflow.states[session.stateId] as WorkflowStateConfig & { calendar?: string };
    const ctx = { ...((session.contextData || {}) as Record<string, any>) };
    // An optional email field: "ma3ndich email" / "pas d'email" moves on instead of looping.
    const emailField = state?.type === 'collect' && typeof state.field === 'object' && state.field?.type === 'email' && state.field.required === false;
    if (emailField && ctx._started && !/@/.test(message)
      && /\b(?:no|don'?t have|pas d'?e?-?mail|n'ai pas|ma3ndich|ma 3ndich|makaynch|ma3endich|skip|sans)\b|ما عنديش|ماعنديش|معنديش|ما عندي|لا أملك|ليس لدي|ما كاينش/iu.test(message)) {
      const f = (state.field as any).name;
      const collected = { ...(((session as any).collectedData || {}) as Record<string, any>), [f]: 'not provided' };
      const nextId = state.next || state.transitions?.[0]?.target;
      const next = nextId ? workflow.states[nextId] : undefined;
      const { lang, script } = this.langOf(session, message, effectiveLang, effectiveScript);
      return { updatedContext: { ...ctx, [f]: 'not provided' }, nextStateId: nextId || null, isComplete: !next || next.type === 'end',
        response: next && next.type !== 'end' ? this.statePrompt(next, config, { ...ctx, ...collected }, lang, script) : '',
        updatedStateHistory: [...(session.stateHistory || []), session.stateId], updatedCollectedData: collected,
        ...((!next || next.type === 'end') && workflow.outcome?.createLead === true ? { createLead: true } : {}) };
    }
    if (!state?.calendar || !ctx._started || isCancellation?.(message)) return null;
    const cal = this.schedulerFor(config);
    if (!cal) {
      const { lang, script } = this.langOf(session, message, effectiveLang, effectiveScript);
      return { updatedContext: ctx, nextStateId: session.stateId,
        response: calendarMessage('unavailable', lang, script, {}), isComplete: false,
        updatedStateHistory: [...(session.stateHistory || [])],
        updatedCollectedData: { ...(((session as any).collectedData || {}) as Record<string, any>) } };
    }
    const { scheduler, cfg } = cal;
    const { lang, script } = this.langOf(session, message, effectiveLang, effectiveScript);
    ctx._lang = lang; ctx._script = script;
    const collected = { ...(((session as any).collectedData || {}) as Record<string, any>) };
    const history = [...(session.stateHistory || [])];
    const tz = cfg.timezone || 'Africa/Casablanca', now = scheduler.now();
    const field = typeof state.field === 'string' ? state.field : (state.field?.name || session.stateId);
    const asksQuestion = /[?؟]/.test(message);
    const stay = (response: string): WorkflowResult => ({ updatedContext: ctx, nextStateId: session.stateId, response, isComplete: false, updatedStateHistory: history, updatedCollectedData: collected });
    const offer = async (day: string): Promise<WorkflowResult | 'unavailable'> => {
      let slots: OfferedSlot[];
      try { slots = await scheduler.freeSlots(cfg, day); } catch (error: any) { logger.warn(`WorkflowCalendar: free slots unavailable: ${error?.message || error}`); return 'unavailable'; }
      const label = dayLabel(day, now, lang, script, tz);
      if (!slots.length) return stay(calendarMessage('noSlots', lang, script, { day: label }));
      collected._calendarDay = day; collected._offeredSlots = slots;
      return { updatedContext: ctx, nextStateId: state.calendar === 'day' ? (state.next || session.stateId) : session.stateId,
        response: calendarMessage('slots', lang, script, { day: label, slots: slotList(slots) }), isComplete: false,
        updatedStateHistory: state.calendar === 'day' ? [...history, session.stateId] : history,
        updatedCollectedData: { ...collected, ...(state.calendar === 'day' ? { [field]: label } : {}) } };
    };

    // Takes a chosen slot (re-checking it is still free) and moves past the slot step and any question already answered.
    const choose = async (slot: OfferedSlot, slotStateId: string, day: string, baseHistory: string[]): Promise<WorkflowResult | null> => {
      const slotState = workflow.states[slotStateId];
      const slotField = typeof slotState.field === 'string' ? slotState.field : (slotState.field?.name || slotStateId);
      let free: boolean;
      try { free = await scheduler.isStillFree(cfg, slot); }
      catch { return stay(calendarMessage('unavailable', lang, script, {})); }
      const label = dayLabel(day, now, lang, script, tz);
      if (!free) {
        let left: OfferedSlot[];
        try { left = await scheduler.freeSlots(cfg, day); } catch { return null; }
        collected._calendarDay = day; collected._offeredSlots = left;
        const response = left.length ? calendarMessage('taken', lang, script, { day: label, slots: slotList(left) }) : calendarMessage('noSlots', lang, script, { day: label });
        return { updatedContext: ctx, nextStateId: slotStateId, response, isComplete: false, updatedStateHistory: baseHistory, updatedCollectedData: collected };
      }
      const when = `${label} ${lang === 'fr' ? 'à' : lang === 'en' ? 'at' : script === 'arabizi' ? 'm3a' : 'مع'} ${slot.label}`;
      Object.assign(collected, { [slotField]: when, _calendarDay: day, _slotStart: slot.start, _slotEnd: slot.end, _slotLabel: slot.label, _slotWhen: when });
      ctx[slotField] = when;
      let nextId = slotState.next || slotState.transitions?.[0]?.target;
      // Skip questions already answered (a slot re-chosen after another customer took the first one).
      const answered = (st?: WorkflowStateConfig) => st?.type === 'collect' && collected[typeof st.field === 'string' ? st.field : (st.field?.name || '')];
      for (let guard = 0; nextId && answered(workflow.states[nextId]) && guard < 10; guard++) nextId = workflow.states[nextId].next;
      const next = nextId ? workflow.states[nextId] : undefined;
      const historyAfter = [...baseHistory, slotStateId];
      if (!nextId || !next || next.type === 'end') {
        return { updatedContext: ctx, nextStateId: nextId || null, response: next ? '' : getWorkflowMessage('completion', lang, script), isComplete: true,
          updatedStateHistory: historyAfter, updatedCollectedData: collected, ...(workflow.outcome?.createLead === true ? { createLead: true } : {}) };
      }
      return { updatedContext: ctx, nextStateId: nextId, response: this.statePrompt(next, config, { ...ctx, ...collected }, lang, script), isComplete: false,
        updatedStateHistory: historyAfter, updatedCollectedData: collected };
    };
    const namesTime = (text: string) => /(?<![\p{L}\d])\d{1,2}(?:\s*[:h.]\s*\d{2})?(?![\d])|sba7|sbah|l3chiya|3chiya|matin|soir|apr[eè]s-midi|morning|afternoon|evening|صباح|العشية|عشية|الليل|المساء/iu.test(text.replace(/\d{1,2}\s*[\/.-]\s*\d{1,2}/g, ''));

    if (state.calendar === 'day') {
      const day = parseDay(message, now, tz);
      if (!day) return asksQuestion ? null : stay(calendarMessage('askDay', lang, script, {}));
      const result = await offer(day);
      if (result === 'unavailable') return stay(calendarMessage('unavailable', lang, script, {}));
      // "lyoma m3a 6 dl3chiya": the day and the time in one message.
      const offeredNow = (result.updatedCollectedData?._offeredSlots || []) as OfferedSlot[];
      const slotStateId = state.next;
      if (slotStateId && result.nextStateId === slotStateId && namesTime(message)) {
        let slot = matchSlot(message, offeredNow);
        if (!slot) { try { slot = matchSlot(message, await scheduler.allFreeSlots(cfg, day)); } catch { slot = null; } }
        if (slot) {
          Object.assign(collected, result.updatedCollectedData);
          return choose(slot, slotStateId, day, [...history, session.stateId]);
        }
      }
      return result;
    }

    if (state.calendar === 'slots') {
      const offered = (collected._offeredSlots || []) as OfferedSlot[];
      if (!offered.length) return null;
      let slot = matchSlot(message, offered);
      if (!slot && namesTime(message) && collected._calendarDay) {
        try { slot = matchSlot(message, await scheduler.allFreeSlots(cfg, collected._calendarDay)); } catch { slot = null; }
      }
      const otherDay = !slot ? parseDay(message, now, tz) : null;
      if (otherDay && otherDay !== collected._calendarDay) {
        const result = await offer(otherDay);
        if (result === 'unavailable') return stay(calendarMessage('unavailable', lang, script, {}));
        const fresh = (result.updatedCollectedData?._offeredSlots || []) as OfferedSlot[];
        const picked = namesTime(message) ? matchSlot(message, fresh) : null;
        if (picked) { Object.assign(collected, result.updatedCollectedData); return choose(picked, session.stateId, otherDay, history); }
        return result;
      }
      if (!slot) return asksQuestion ? null : stay(calendarMessage('pickSlot', lang, script, { slots: slotList(offered) }));
      return choose(slot, session.stateId, collected._calendarDay as string, history);
    }
    return null;
  }

  /** Personalised pitch, booking on completion and {{field}} placeholders. */
  async after(result: WorkflowResult, session: WorkflowSession, workflow: WorkflowConfig, config: BusinessConfig,
    llm?: LLMProvider, llmOptions?: LLMRequestOptions): Promise<WorkflowResult> {
    const ctx = result.updatedContext || {};
    const lang = ctx._lang || 'en', script = ctx._script || (lang === 'darija' ? 'arabic' : 'latin');
    const collected = { ...(result.updatedCollectedData || {}) };
    let response = result.response;

    const next = result.nextStateId ? workflow.states[result.nextStateId] as WorkflowStateConfig & { pitch?: boolean | string } : undefined;
    if (next?.pitch && result.nextStateId !== session.stateId && !result.isComplete && llm) {
      const pitch = await this.pitch(next.pitch, config, collected, lang, script, llm, llmOptions);
      if (pitch) response = `${pitch}\n\n${response}`;
    }

    const cal = this.schedulerFor(config);
    if (result.isComplete && (workflow as any).calendarBooking && collected._slotStart && collected._confirmed !== false && !collected._booked && cal) {
      const slot: OfferedSlot = { start: collected._slotStart, end: collected._slotEnd, label: collected._slotLabel };
      const booking = await cal.scheduler.book(cal.cfg, slot, collected);
      // Someone else took the slot in the meantime: offer what is still free instead of giving up.
      const slotState = Object.entries(workflow.states).find(([, st]) => (st as any).calendar === 'slots')?.[0];
      if (!booking.ok && booking.reason === 'SLOT_TAKEN' && slotState && collected._calendarDay) {
        const tz = cal.cfg.timezone || 'Africa/Casablanca', now = cal.scheduler.now();
        let left: OfferedSlot[] = [];
        try { left = await cal.scheduler.freeSlots(cal.cfg, collected._calendarDay); } catch { left = []; }
        if (left.length) {
          const { createLead: _lead, requestHumanHandoff: _handoff, handoffPauseHours: _pause, ...rest } = result as any;
          return { ...rest, isComplete: false, nextStateId: slotState,
            updatedCollectedData: { ...collected, _offeredSlots: left, _slotStart: undefined, _slotEnd: undefined },
            response: calendarMessage('taken', lang, script, { day: dayLabel(collected._calendarDay, now, lang, script, tz), slots: slotList(left) }) };
        }
      }
      collected._booked = booking.ok;
      collected.demoBooked = booking.ok ? 'yes' : 'no — team to confirm';
      const when = String(collected._slotWhen || slot.label);
      response = booking.ok ? calendarMessage('booked', lang, script, { when }) : calendarMessage('notBooked', lang, script, { when });
    } else if (result.isComplete && workflow.calendarBooking && collected._slotStart && !collected._booked && !cal) {
      const when = String(collected._slotWhen || collected._slotLabel || '');
      collected.demoBooked = 'no — team to confirm';
      response = calendarMessage('notBooked', lang, script, { when });
    }

    if (/\{\{?[a-zA-Z0-9_]+\}?\}/.test(response)) {
      const values = Object.fromEntries(Object.entries({ ...ctx, ...collected, slotWhen: collected._slotWhen }).filter(([k]) => !k.startsWith('_') || k === 'slotWhen'));
      response = ResponseBuilder.interpolateTemplate(response, values).replace(/[ \t]{2,}/g, ' ').replace(/\s+([!?.,،؟])/g, '$1');
    }
    return { ...result, response, updatedCollectedData: collected };
  }

  private async pitch(instruction: boolean | string, config: BusinessConfig, collected: Record<string, any>, lang: string, script: string,
    llm: LLMProvider, llmOptions?: LLMRequestOptions): Promise<string | null> {
    const answers = Object.entries(collected).filter(([k, v]) => !k.startsWith('_') && v !== undefined && String(v).trim()).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join('\n');
    const facts = [(config as any).identity?.brand, (config as any).identity?.industry, ...((config.capabilities?.faq || []) as any[]).slice(0, 14).map(f => `${f.question} → ${f.answer}`)]
      .filter(Boolean).join('\n').slice(0, 6000);
    const language = lang === 'fr' ? 'French' : lang === 'en' ? 'English' : lang === 'ar' ? 'Modern Standard Arabic (فصحى), not Moroccan Darija' :script === 'arabizi' ? 'Moroccan Darija written in Latin letters (Arabizi)' : 'Moroccan Darija written in Arabic script';
    const system = `You are the WhatsApp sales assistant of this business. Write 2 short sentences for this prospect: first show you understood their situation from their answers, then explain concretely how the business's assistant solves their main problem. ${typeof instruction === 'string' ? instruction : ''}
Use ONLY the business facts. No prices, no numbers or features that are not in the facts, no greeting, no question, no markdown, at most 300 characters. Write ONLY in ${language}, even when the facts are written in another language or dialect.
BUSINESS FACTS:\n${facts}`;
    // The pitch must be in the customer's script; a wrong-script pitch would make the reply checker replace the whole
    // message (and the demo invite with it), so retry once and otherwise leave the pitch out.
    const wantsArabic = lang === 'ar' || (lang === 'darija' && script !== 'arabizi');
    const scriptOk = (t: string) => {
      const arabic = (t.match(/[؀-ۿ]/g) || []).length, latin = (t.match(/[A-Za-z]/g) || []).length;
      if (!(wantsArabic ? arabic >= latin : arabic <= latin * 0.1)) return false;
      // Formal Arabic must not slip into Darija (ديال، باش، كيجاوب...).
      return lang !== 'ar' || !/(?:^|\s)(?:ك[يتن]\p{L}{2,}|ديال\p{L}*|باش|بزاف|دابا|واش|غادي)(?=\s|$|[،.!])/u.test(t);
    };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const reminder = attempt ? `\nIMPORTANT: use ${lang === 'ar' ? 'Modern Standard Arabic (فصحى) only, never Darija words such as ديال، باش، كيجاوب، كيعاني' : wantsArabic ? 'Arabic letters only' : 'Latin letters only, no Arabic script'}.` : '';
        const text = (await llm.generateResponse(system + reminder, [{ role: 'user', content: `PROSPECT ANSWERS:\n${answers}` }], { ...llmOptions, maxTokens: 160, temperature: 0.4 })).trim();
        const clean = text.replace(/\*\*/g, '').replace(/^(?:bonjour|bonsoir|hello|hi|hey|salam|slm|السلام عليكم|سلام|مرحبا|أهلا|اهلا)[\s,،!]+/iu, '');
        if (clean && clean.length <= 420 && !/\d+\s*(?:mad|dh|درهم|€|\$)/iu.test(clean) && scriptOk(clean)) return clean;
      }
      return null;
    } catch (error: any) {
      logger.warn(`WorkflowCalendar: pitch unavailable: ${error?.message || error}`);
      return null;
    }
  }
}
