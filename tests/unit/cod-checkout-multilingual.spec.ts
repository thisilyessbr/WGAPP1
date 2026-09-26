import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { CRMService } from '../../src/domain/crm/CRMService';

const scope: any = { window: {} };
runInNewContext(readFileSync('src/portal/ui/workflows.js','utf8'),scope);
const workflow = scope.window.RelayqoWorkflows.template('cod','checkout_stress');

describe('cash-on-delivery checkout in three languages', () => {
  it.each([
    ['darija','arabic','واخا',/الخلاص عند التوصيل/u,/المنتوج/u],
    ['darija','arabizi','wakha',/paiement 3nd livraison/i,/Lproduit/],
    ['fr','latin','oui',/paiement à la livraison/i,/Produit/],
    ['ar','arabic','نعم',/للدفع عند الاستلام/u,/المنتج/u]
  ])('%s/%s collects a complete ticket and creates a lead only after confirmation', async (lang, script, yes, confirmationPattern, labelPattern) => {
    const engine = new WorkflowEngine(new WorkflowStateEvaluator());
    const upsert = vi.fn(async () => ({id:'lead-1'}));
    const crm = new CRMService({lead:{upsert}} as any);
    const session: any = {
      id:'session',tenantId:'tenant',conversationId:'conversation',workflowId:workflow.id,
      stateId:'start',status:'ACTIVE',contextData:{_started:true,_lang:lang},
      collectedData:{},stateHistory:[],createdAt:new Date(),updatedAt:new Date()
    };
    const values = ['حذاء رياضي','2','أمينة','0612345678','Rabat','12 Rue Hassan'];
    for (const value of values) {
      const result = await engine.process(session,value,workflow,DEFAULT_BUSINESS_CONFIG,undefined,undefined,undefined,undefined,lang,script);
      expect(result.isComplete).toBe(false);
      expect(result.response).not.toContain('Which product');
      Object.assign(session,{stateId:result.nextStateId,contextData:result.updatedContext,
        collectedData:result.updatedCollectedData,stateHistory:result.updatedStateHistory});
      await crm.processTurnSignal({tenantId:'tenant',accountId:'account',customerId:'customer',
        isWorkflowCompleted:false,workflowId:workflow.id,userMessage:value});
    }
    expect(session.stateId).toBe('confirm');
    expect(session.collectedData).toMatchObject({product:values[0],quantity:values[1],customer_name:values[2],phone:values[3],city:values[4],address:values[5]});
    const confirmation = await engine.process(session,'?',workflow,DEFAULT_BUSINESS_CONFIG,undefined,undefined,undefined,undefined,lang,script);
    expect(confirmation.response).toMatch(confirmationPattern);
    expect(confirmation.response).toMatch(labelPattern);
    expect(confirmation.response).not.toContain('product:');
    expect(upsert).not.toHaveBeenCalled();
    const accepted = await engine.process(session,yes,workflow,DEFAULT_BUSINESS_CONFIG,undefined,undefined,undefined,undefined,lang,script);
    expect(accepted.isComplete).toBe(true);
    expect(accepted.nextStateId).toBe('done');
    expect(accepted.updatedCollectedData).toMatchObject({...session.collectedData,_confirmed:true});
    await crm.processTurnSignal({tenantId:'tenant',accountId:'account',customerId:'customer',
      isWorkflowCompleted:true,workflowId:workflow.id,workflowConfig:workflow,terminalStateId:accepted.nextStateId,userMessage:yes});
    expect(upsert).toHaveBeenCalledTimes(1);
  });
  it.each(['la','non','لا'])('does not turn a cancelled checkout into a lead: %s', async no => {
    const engine = new WorkflowEngine(new WorkflowStateEvaluator());
    const upsert = vi.fn();
    const crm = new CRMService({lead:{upsert}} as any);
    const session: any = {id:'session',tenantId:'tenant',conversationId:'conversation',workflowId:workflow.id,
      stateId:'confirm',status:'ACTIVE',contextData:{_started:true,_lang:'darija'},collectedData:{product:'Shoes'},stateHistory:[],createdAt:new Date(),updatedAt:new Date()};
    const cancelled = await engine.process(session,no,workflow,DEFAULT_BUSINESS_CONFIG);
    expect(cancelled.isComplete).toBe(true);
    expect(cancelled.nextStateId).toBeNull();
    expect(cancelled.updatedCollectedData).toMatchObject({product:'Shoes',_confirmed:false});
    await crm.processTurnSignal({tenantId:'tenant',accountId:'account',customerId:'customer',
      isWorkflowCompleted:true,workflowId:workflow.id,workflowConfig:workflow,terminalStateId:'confirm',userMessage:no});
    expect(upsert).not.toHaveBeenCalled();
  });
});
