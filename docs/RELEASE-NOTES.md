# Top of the Desk 0.9.66

Choose shortcuts in **Settings → Top of the Desk → Toolbar**. Every icon, including Edit, can be turned on or off. Turn all of them off to hide the floating toolbar completely, including its empty pill and touch toggle. Right-click an item’s heading or background and choose Edit to access its actions. Shift+F10 opens the same menu from the keyboard. Names and scope appear on hover or focus. Drag icons or use the Left and Right arrow keys to reorder them. Reset restores Resize, Edit, Add notes, and the default order.

- Toolbar changes update only the controls, without refreshing sources, stack switchers, layout, or file choices. Unchanged controls and tooltips avoid repeated DOM writes.
- Fixed missing hover tooltips in separate settings windows. Pointer exit, scrolling, and window closure cancel pending tooltips.
- Recently opened now tracks returning to an open website or the Obsidian window. Revisits survive reloads and remain within the seven-day window; clearing the corresponding Web viewer history removes them.
- Edit uses aligned fields, a compact two-column grid of controls, subtle selected states, and Save at the bottom. Controls stack vertically in narrow windows.
- Hide heading and Hide Base toolbar use matching icon buttons alongside the other Edit controls, in the chosen toolbar order. Their highlighted state reflects the current draft; Save applies it and Cancel discards it.
- Edit now includes Move, Resize, and Add notes alongside the existing appearance and removal options.
- Edit no longer reappears automatically. Keyboard focus returns to a visible control or the item itself when a shortcut is hidden.
- The toolbar preview, visibility switches, and ordering list are combined into one compact strip. Unselected shortcuts stay dimmed; tooltips explain which controls apply only to stacks.
- Toolbar choices apply throughout the desk; unavailable actions stay hidden. Compact PDFs, audio, canvases, and websites retain their required headings and fixed sizes.
- Resize changes inside Edit are saved with the rest of the form. Cancel discards them, and Add notes preserves any unsaved form text.
- Keyboard movement works with the toolbar hidden. Toolbar changes preserve mounted editors, playback, and Base previews.

Requires desktop Obsidian 1.14.4 or later. Replace only `main.js`, `manifest.json`, and `styles.css`, and reload the plugin. Preserve your existing `data.json`.
