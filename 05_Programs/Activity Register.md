---
type: register
cssclasses:
  - meeting-wide-tables
---

# Activity Register

Keep one row per dated activity edition, across Qahwa gatherings, Expert Talks, working group sessions and other chapter events. These records feed [[Chapter Dashboard]].

Use the blank row or **New Row**. Owner and Status are dropdowns; Date opens a calendar. Enter a note link in Activity / Edition when an edition has its own note. The first two entries come from existing announcements and operations notes; their delivery remains TBD.

## Editions

```smart-table
{"columns":[{"id":"activity","name":"Activity / Edition","type":"text","width":255},{"id":"series","name":"Activity Type","type":"select","width":170,"options":[{"label":"Qahwa Gathering","color":"gray"},{"label":"Expert Talk","color":"gray"},{"label":"Workshop","color":"gray"},{"label":"Working Group Session","color":"gray"},{"label":"Conference","color":"gray"},{"label":"Other","color":"gray"}]},{"id":"date","name":"Date","type":"date","width":145},{"id":"owner","name":"Owner","type":"select","width":170,"options":[{"label":"TBD","color":"gray"},{"label":"Dr. Maged Elaasar","color":"gray"},{"label":"Dr. Bassem Hassan","color":"gray"},{"label":"Moataz Hassan","color":"gray"},{"label":"Mohamed Adel","color":"gray"},{"label":"Mahmoud Fouda","color":"gray"},{"label":"Omar Hussein","color":"gray"}]},{"id":"status","name":"Status","type":"status","width":135,"options":[{"label":"TBD","color":"gray"},{"label":"Planned","color":"blue"},{"label":"Held","color":"green"},{"label":"Postponed","color":"orange"},{"label":"Cancelled","color":"gray"}]},{"id":"registrations","name":"Registrations","type":"number","width":120},{"id":"attendees","name":"Attendees","type":"number","width":110},{"id":"evidence","name":"Evidence / Report","type":"text","width":240},{"id":"notes","name":"Notes","type":"text","width":300}],"rows":[{"id":"activity-expert-talk-20250928","cells":{"activity":"[[07_Communications/AI-Powered Systems Engineering|AI-Powered Systems Engineering]]","series":"Expert Talk","date":"2025-09-28","owner":"TBD","status":"TBD","registrations":"","attendees":"","evidence":"[[07_Communications/AI-Powered Systems Engineering]]","notes":"Announced date from the existing note. Delivery and attendance are not confirmed by the announcement. Dr. Bassem Hassan is the recorded speaker, not an inferred event owner."}},{"id":"activity-qahwa-20261101","cells":{"activity":"[[07_Communications/Qahwa Gathering Operations|Qahwa Gathering 1 November 2026]]","series":"Qahwa Gathering","date":"2026-11-01","owner":"Omar Hussein","status":"TBD","registrations":"","attendees":"","evidence":"[[07_Communications/Qahwa Gathering Operations]]","notes":"Date carried from the existing operations note; confirm the edition and delivery status. No attendance figure has been recorded."}},{"id":"activity-next-edition","cells":{"activity":"","series":"","date":"","owner":"TBD","status":"TBD","registrations":"","attendees":"","evidence":"","notes":""}}],"sort":null,"filters":{},"showFilters":false}
```

## Recording Attendance

- Use **Planned** once an edition is agreed, **Held** once delivery is confirmed, or **Postponed / Cancelled** when applicable.
- Add aggregate Registrations and Attendees from the event platform or attendance report. Count each person once within an edition, rather than reconnects or duplicate platform rows.
- Leave unknown numbers blank. Zero means a confirmed count of zero. Link the report or supporting note in Evidence / Report.
- Update the same row when the edition moves from planning to delivery. An announcement or completed invitation action does not confirm that the edition was held.

The dashboard sums attendance visits across editions; this is not a unique participant count. Activity statistics use Held editions with recorded figures. No names or emails of event participants are required here.

[[Programs]] · [[Communications]] · [[Chapter Dashboard]]

## Linked Notes

<!-- menacose-table-links:start -->
- [[07_Communications/AI-Powered Systems Engineering|AI-Powered Systems Engineering]]
- [[07_Communications/Qahwa Gathering Operations|Qahwa Gathering 1 November 2026]]
<!-- menacose-table-links:end -->
