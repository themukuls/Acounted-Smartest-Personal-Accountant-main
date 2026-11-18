import { describe, expect, test } from 'bun:test';
import { TAX_FEATURE_ENABLED, TAX_PATHS } from './features';

describe('product feature switches', () => {
  test('keeps the Tax experience dormant in this release', () => {
    expect(TAX_FEATURE_ENABLED).toBe(false);
  });

  test('tracks every legacy Tax entry point for route protection', () => {
    expect(TAX_PATHS).toContain('/tax-copilot');
    expect(TAX_PATHS).toContain('/tax-planner-ai');
    expect(TAX_PATHS).toContain('/tds-tracker');
    expect(new Set(TAX_PATHS).size).toBe(TAX_PATHS.length);
  });
});
