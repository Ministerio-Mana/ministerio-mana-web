# Cumbre Event Management UX/UI Benchmark (2026-03-06)

Objective: gather proven UX patterns from mature admin interfaces and apply them to Portal Mana event modules without removing functionality.

## References reviewed
- Stripe Dashboard docs: data-dense operations, fast search/filter actions, issue handling views.
  - https://docs.stripe.com/dashboard
- MUI Data Grid docs: pagination, sorting, and filtering behavior for large datasets.
  - https://mui.com/x/react-data-grid/pagination/
  - https://mui.com/x/react-data-grid/filtering/
- GOV.UK Design System pagination pattern: explicit page controls as an alternative to infinite scrolling in operational workflows.
  - https://design-system.service.gov.uk/components/pagination/

## Patterns extracted
1. Keep critical actions visible, but move list exploration to explicit controls (search, filters, sort, page size).
2. Avoid unbounded scroll in operational queues; use pagination with result counts.
3. Keep responsive action rows from overflowing by using `min-w-0`, full-width on mobile, and fixed-width only on larger breakpoints.
4. Show "X-Y of Z" to keep operators oriented while triaging records.

## Applied to Portal Mana
- Centro de Soluciones:
  - Added search, sort, page size, and pagination controls.
  - Added visible count and range summary.
  - Fixed `Asignar` row overflow in responsive layout.
- Cuotas Pendientes:
  - Added search, status filter, page size, count, and pagination.
- Ultimos Pagos:
  - Added search, status/provider/date filters, sort, page size, count, and pagination.
  - Enabled viewing all payment statuses in UI filtering flow.

## Next waves recommended
1. Saveable "views" per admin (e.g., Pending today, Mismatch high amount).
2. Bulk actions for reminders/assignment with guarded confirmation.
3. Compact/comfortable density toggle for desktop operators.
4. Cross-module filter consistency (same control order and labels in all admin modules).
