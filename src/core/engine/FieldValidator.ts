import { WorkflowFieldConfig } from '../../domain/tenant/BusinessConfig';

export class FieldValidator {
  /**
   * Validates an extracted value against the generic field configuration.
   * Returns an error message if invalid, or null if valid.
   */
  validate(value: any, config: WorkflowFieldConfig): string | null {
    if (value === null || value === undefined) {
      // The field is missing. The engine will naturally prompt for it.
      // We don't need a specific error prefix.
      return null;
    }

    // Type validation
    if (config.type === 'string' && typeof value !== 'string') return 'Value must be a string.';
    if (config.type === 'number' && typeof value !== 'number') {
       // Coerce string numbers if possible, but the LLM should output JSON numbers
       if (typeof value === 'string' && !isNaN(Number(value))) {
           // We'll let it slide, but strict typing is better.
       } else {
           return 'Value must be a number.';
       }
    }
    if (config.type === 'boolean' && typeof value !== 'boolean') return 'Value must be a boolean.';

    // Enum validation
    if (config.type === 'enum' && config.options) {
      const strVal = String(value);
      if (!config.options.includes(strVal)) {
        return `Value must be one of: ${config.options.join(', ')}.`;
      }
    }

    // Constraints
    if (typeof value === 'string') {
      if (config.minLength !== undefined && value.length < config.minLength) {
        return `Length must be at least ${config.minLength}.`;
      }
      if (config.maxLength !== undefined && value.length > config.maxLength) {
        return `Length must be at most ${config.maxLength}.`;
      }
      
      const pattern = config.pattern || config.validationRegex;
      if (pattern) {
        const regex = new RegExp(pattern);
        if (!regex.test(value)) {
          return 'Value format is invalid.';
        }
      }
    }

    if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
      const numVal = Number(value);
      if (config.min !== undefined && numVal < config.min) {
        return `Value must be at least ${config.min}.`;
      }
      if (config.max !== undefined && numVal > config.max) {
        return `Value must be at most ${config.max}.`;
      }
    }

    // Date/Time validation (basic format checks)
    if (config.type === 'date' || config.type === 'datetime') {
      const d = new Date(value);
      if (isNaN(d.getTime())) {
        return 'Value must be a valid date.';
      }
    }

    return null; // Valid
  }
}
