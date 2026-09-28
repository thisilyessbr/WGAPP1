import { describe, expect, it } from 'vitest';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { validateAdminConfig } from '../../src/portal/validation';
const validator=new FieldValidator();
describe('safe custom workflow patterns',()=>{
  it('validates ordinary patterns and Arabic without changing field semantics',()=>{
    expect(validator.validate('ABC-123',{type:'string',pattern:'^[A-Z]+-\\d+$'})).toBeNull();
    expect(validator.validate('ABC-no',{type:'string',pattern:'^[A-Z]+-\\d+$'})).toBeTruthy();
    expect(validator.validate('سلام',{type:'string',pattern:'^[\\p{Arabic}]+$'})).toBeNull();
  });
  it.each(['(?=a)a','(a)\\1','[','a'.repeat(1025)])('rejects unsupported or oversized patterns at save and runtime',pattern=>{
    expect(()=>validateAdminConfig({workflows:{test:{initialState:'ask',states:{ask:{type:'collect',field:{type:'string',pattern}}}}}})).toThrow();
    expect(validator.validate('a',{type:'string',pattern})).toBeTruthy();
  });
  it('caps customer input and accepts the legacy validationRegex key safely',()=>{
    expect(validator.validate('a'.repeat(8193),{type:'string',validationRegex:'a+'})).toBeTruthy();
    expect(validator.validate('123',{type:'string',validationRegex:'^\\d+$'})).toBeNull();
  });
});
