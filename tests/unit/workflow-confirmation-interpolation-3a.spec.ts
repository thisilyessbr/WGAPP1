import { describe, it, expect } from 'vitest';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';

describe('Phase FIX-PROBLEM-3A: Generic Workflow Confirmation Interpolation', () => {
  const responseBuilder = new ResponseBuilder();

  describe('ResponseBuilder.interpolateTemplate unit tests', () => {
    it('A. {name} interpolates correctly', () => {
      const res = ResponseBuilder.interpolateTemplate('Hello {name}!', { name: 'Mohamed' });
      expect(res).toBe('Hello Mohamed!');
    });

    it('B. {{name}} interpolates correctly', () => {
      const res = ResponseBuilder.interpolateTemplate('Hello {{name}}!', { name: 'Mohamed' });
      expect(res).toBe('Hello Mohamed!');
    });

    it('C. {phone} interpolates correctly', () => {
      const res = ResponseBuilder.interpolateTemplate('Phone: {phone}', { phone: '0600000000' });
      expect(res).toBe('Phone: 0600000000');
    });

    it('D. {{email}} interpolates correctly', () => {
      const res = ResponseBuilder.interpolateTemplate('Email: {{email}}', { email: 'test@example.com' });
      expect(res).toBe('Email: test@example.com');
    });

    it('E. arbitrary workflow field names interpolate correctly', () => {
      const template = 'Topic: {consultation_topic}, Date: {preferred_date}, Time: {preferred_time}';
      const data = {
        consultation_topic: 'Digital marketing',
        preferred_date: '2026-09-01',
        preferred_time: '14:00'
      };
      const res = ResponseBuilder.interpolateTemplate(template, data);
      expect(res).toBe('Topic: Digital marketing, Date: 2026-09-01, Time: 14:00');
    });

    it('F. {summary} interpolates correctly', () => {
      const res = ResponseBuilder.interpolateTemplate('Please confirm:\n{summary}', { summary: 'name: Saber\nphone: 0612345678' });
      expect(res).toBe('Please confirm:\nname: Saber\nphone: 0612345678');
    });

    it('G. {{summary}} interpolates correctly', () => {
      const res = ResponseBuilder.interpolateTemplate('Please confirm:\n{{summary}}', { summary: 'name: Saber\nphone: 0612345678' });
      expect(res).toBe('Please confirm:\nname: Saber\nphone: 0612345678');
    });

    it('H. missing field -> empty string', () => {
      const res = ResponseBuilder.interpolateTemplate('Name: {name}, Phone: {phone}', { name: 'Mohamed' });
      expect(res).toBe('Name: Mohamed, Phone: ');
    });

    it('I. null/undefined values -> empty string', () => {
      const res = ResponseBuilder.interpolateTemplate('Name: {name}, Phone: {phone}, Email: {email}', {
        name: 'Mohamed',
        phone: null,
        email: undefined
      });
      expect(res).toBe('Name: Mohamed, Phone: , Email: ');
    });

    it('J. internal keys starting with _ are not exposed', () => {
      const res = ResponseBuilder.interpolateTemplate('Lang: {_lang}, Step: {_stepCount}', {
        _lang: 'en',
        _stepCount: 5,
        _started: true
      });
      expect(res).toBe('Lang: , Step: ');
    });

    it('K. unrelated text and non-identifier braces are preserved', () => {
      const res = ResponseBuilder.interpolateTemplate('Price: $50 {not_in_data} and {1, 2}', {
        foo: 'bar'
      });
      expect(res).toBe('Price: $50  and {1, 2}');
    });

    it('L. full confirmation prompt contains zero unresolved known placeholders', () => {
      const template = 'Confirm booking for {name} ({phone}) on {preferred_date} at {preferred_time} for {consultation_topic}?';
      const data = {
        name: 'Mohamed Saber',
        phone: '+212 600-000000',
        preferred_date: 'Friday',
        preferred_time: '15:30',
        consultation_topic: 'Business Strategy'
      };
      const res = ResponseBuilder.interpolateTemplate(template, data);
      expect(res).toBe('Confirm booking for Mohamed Saber (+212 600-000000) on Friday at 15:30 for Business Strategy?');
      expect(res).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
    });
  });

  describe('WorkflowEngine multi-field confirmation integration test', () => {
    const engine = new WorkflowEngine();

    const multiFieldWorkflow: WorkflowConfig = {
      id: 'appointment_flow',
      name: 'Appointment Flow',
      description: 'Multi-field flow with template confirmation',
      initialState: 'collect_name',
      states: {
        collect_name: {
          type: 'collect',
          field: { name: 'name', type: 'string', required: true },
          prompt: 'Enter name:',
          next: 'collect_phone'
        },
        collect_phone: {
          type: 'collect',
          field: { name: 'phone', type: 'phone', required: true },
          prompt: 'Enter phone:',
          next: 'collect_email'
        },
        collect_email: {
          type: 'collect',
          field: { name: 'email', type: 'email', required: true },
          prompt: 'Enter email:',
          next: 'collect_topic'
        },
        collect_topic: {
          type: 'collect',
          field: { name: 'topic', type: 'string', required: true },
          prompt: 'Enter topic:',
          next: 'collect_date'
        },
        collect_date: {
          type: 'collect',
          field: { name: 'date', type: 'string', required: true },
          prompt: 'Enter date:',
          next: 'collect_time'
        },
        collect_time: {
          type: 'collect',
          field: { name: 'time', type: 'string', required: true },
          prompt: 'Enter time:',
          next: 'confirm_step'
        },
        confirm_step: {
          type: 'confirm',
          prompt: 'Confirm booking for {name} ({phone}, {email}) regarding {topic} on {date} at {time}?',
          next: 'end_step'
        },
        end_step: {
          type: 'end',
          prompt: 'Booking confirmed!'
        }
      }
    };

    it('reaches confirm_step and interpolates all actual values into prompt', async () => {
      const session: WorkflowSession = {
        id: `sess-${Date.now()}`,
        tenantId: 'test-tenant',
        conversationId: 'test-conv',
        workflowId: 'appointment_flow',
        stateId: 'collect_time',
        status: 'ACTIVE',
        contextData: {
          _started: true,
          name: 'Ilyes Saber',
          phone: '+212 612-345678',
          email: 'ilyes@example.com',
          topic: 'Architecture Review',
          date: '2026-09-15'
        },
        stateHistory: ['collect_name', 'collect_phone', 'collect_email', 'collect_topic', 'collect_date'],
        collectedData: {
          name: 'Ilyes Saber',
          phone: '+212 612-345678',
          email: 'ilyes@example.com',
          topic: 'Architecture Review',
          date: '2026-09-15'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // User supplies the final field (time: "14:00")
      const res = await engine.process(session, '14:00', multiFieldWorkflow, DEFAULT_BUSINESS_CONFIG);

      expect(res.nextStateId).toBe('confirm_step');
      expect(res.response).toBe('Confirm booking for Ilyes Saber (+212 612-345678, ilyes@example.com) regarding Architecture Review on 2026-09-15 at 14:00?');
    });
  });
});
