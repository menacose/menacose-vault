# MENACOSE Table Links

A local companion to Smart Table. Its source and settings live in this vault; Smart Table itself is unchanged.

- A Smart Table text cell containing one `[[Note]]` or `[[Path/Note|Display Name]]` becomes a clickable note link. Use the pencil button to edit the original cell. Ctrl/Cmd-click opens a separate tab.
- A normal Markdown link list is maintained between `menacose-table-links` comments. Obsidian indexes those links for native backlinks; links hidden inside JSON code blocks alone would not be indexed. Edit the table rather than the generated list.
- On an Obsidian note rename/move, linked cells are updated. Matching Related Work choices are updated when the old note name is unambiguous. Other text and historical plain-text mentions are unchanged.
- New links can point to a note that does not exist yet; clicking uses Obsidian's normal open/create flow. Include `04_Projects/` in a new project's target to select its folder.
- Disabling this extension restores plain editable Smart Table cells. The saved wiki-link strings and generated Markdown links remain in the notes.

Requires the installed Smart Table plugin for table rendering. No network calls or external dependencies. Structural checks and simulated DOM/persistence tests are run during setup; visual behaviour should be checked after reloading Obsidian. Detached pop-out windows are outside the current DOM observer scope; use the main window for linked cells.

## Connected Meeting Tables

- Weekly notes can opt into editable views of Work Overview and Action Register. Section 2 combines actions and work, distinguished by Type; Section 4 contains new commitments.
- Edits propagate by stable, invisible row bindings. Values and bindings are stored inside the Smart Table JSON, not YAML. Plain copied tables and historical notes without opt-in metadata are untouched.
- A blank commitment is not published until its Action has text. Removing a row from a meeting does not delete the underlying source row. New register rows appear in the connected review.
- Three-way comparison preserves independent changes in different fields. Conflicting edits to the same cell keep both values and raise a notice; set either cell to match the other. Source writes check that the text still matches what was read and retry if another edit intervened.
- Finish Meeting & Keep Snapshot freezes the meeting tables. Connect For Editing activates a meeting and freezes the previous connected meeting. A copied note is disconnected until explicitly connected, since its stored meeting path does not match the copy.
- Use Prepare Today’s Weekly Meeting from the command palette, or the updated meeting template followed by Connect For Editing. The template itself never syncs.
- Reload Obsidian after installing/updating this companion. Ordinary Smart Table editing still works with this companion disabled, but synchronization and meeting controls need it enabled.

The registers currently live at 04_Projects/Work Overview.md and 04_Projects/Action Register.md. Keep those paths, or update SOURCES in meeting-sync.js and rebuild. In a conflict, resolve the notice before finishing or connecting another meeting.

## Development

meeting-sync.js contains the sync engine; table-links.js contains the plugin integration and link features. Run node build.cjs in this folder to produce the self-contained main.js used by Obsidian. Runtime code has no filesystem/module dependencies beyond Obsidian, so relative module loading is not required on desktop or mobile.

Run node --test tests/meeting-sync.test.cjs for merge, conflict, history, new-action and guarded-write checks. Smart Table's installed renderer is also exercised with a simulated DOM during setup; the actual Obsidian interface still needs a visual check.
