/**
 * Product feature switches.
 *
 * Tax is intentionally dormant, not deleted. Keeping the switch here makes
 * re-enabling the complete experience an explicit one-line product decision.
 */
export const TAX_FEATURE_ENABLED = false;

export const TAX_PATHS = [
  '/tax-copilot',
  '/tax-optimization',
  '/tax-assistant',
  '/tax-planner-ai',
  '/tax-calendar',
  '/advance-tax',
  '/capital-gains',
  '/tds-tracker',
  '/tax-compliance',
  '/salary-restructuring',
  '/itr-readiness',
] as const;

