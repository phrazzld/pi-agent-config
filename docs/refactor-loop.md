# Refactor Loop (Operational)

Goal: pair reflection with scheduled complexity paydown.

## Weekly loop

1. **Inventory**
   - regenerate runtime inventory (`./scripts/gen-runtime-inventory.sh`)
   - inspect extension surfaces and test coverage
2. **Select hotspot**
   - choose one high-churn/high-risk module
3. **Refactor**
   - simplify boundaries (thin entrypoint, pure logic modules)
   - add/upgrade focused tests
4. **Verify**
   - `./scripts/test-extensions.sh`
   - targeted smoke command for changed extension
5. **Record**
   - add a short note to PR: removed complexity, remaining risk

## Selection heuristics

Pick work that:
- reduces fan-out risk,
- removes duplicate policy logic,
- improves observability/debuggability,
- lowers onboarding cognitive load.

## Avoid

- cosmetic churn without boundary simplification,
- broad rewrite without tests,
- preserving accidental compatibility when not required.
