export type ShortcutScope = "App" | "Canvas" | "Source";

export type ShortcutDefinition = {
  id: string;
  label: string;
  binding: string;
  scope: ShortcutScope;
  when: string;
};

export const KEYBOARD_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "save",
    label: "Save",
    binding: "Ctrl/Cmd+S",
    scope: "App",
    when: "Any focus",
  },
  {
    id: "apply-source",
    label: "Apply source",
    binding: "Ctrl/Cmd+Enter",
    scope: "Source",
    when: "Any focus",
  },
  {
    id: "undo",
    label: "Undo document change",
    binding: "Ctrl/Cmd+Z",
    scope: "App",
    when: "Outside text fields",
  },
  {
    id: "redo-shift",
    label: "Redo document change",
    binding: "Ctrl/Cmd+Shift+Z",
    scope: "App",
    when: "Outside text fields",
  },
  {
    id: "redo-y",
    label: "Redo document change",
    binding: "Ctrl/Cmd+Y",
    scope: "App",
    when: "Outside text fields",
  },
  {
    id: "mode-text",
    label: "Text mode",
    binding: "1",
    scope: "Canvas",
    when: "Outside text fields",
  },
  {
    id: "mode-select",
    label: "Select mode",
    binding: "2",
    scope: "Canvas",
    when: "Outside text fields",
  },
  {
    id: "mode-move",
    label: "Move mode",
    binding: "3",
    scope: "Canvas",
    when: "Outside text fields",
  },
  {
    id: "mode-preview",
    label: "Preview mode",
    binding: "4",
    scope: "Canvas",
    when: "Outside text fields",
  },
  {
    id: "move-right",
    label: "Nudge selected element",
    binding: "Arrow keys",
    scope: "Canvas",
    when: "Move mode, outside text fields",
  },
  {
    id: "move-slow",
    label: "Fine nudge selected element",
    binding: "Shift+Arrow keys",
    scope: "Canvas",
    when: "Move mode, outside text fields",
  },
  {
    id: "delete",
    label: "Delete selected element",
    binding: "Delete/Backspace",
    scope: "Canvas",
    when: "Outside text fields",
  },
  {
    id: "escape",
    label: "Exit editing or clear selection",
    binding: "Esc",
    scope: "Canvas",
    when: "Canvas focus",
  },
];

export function shortcutMapRows(shortcuts = KEYBOARD_SHORTCUTS) {
  return shortcuts.map((shortcut) => ({
    ...shortcut,
    searchText: `${shortcut.label} ${shortcut.binding} ${shortcut.scope} ${shortcut.when}`.toLowerCase(),
  }));
}

export function duplicateShortcutBindings(shortcuts = KEYBOARD_SHORTCUTS) {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const shortcut of shortcuts) {
    const key = `${shortcut.scope}:${shortcut.binding}`.toLowerCase();
    const existing = seen.get(key);
    if (existing) duplicates.push(`${existing}/${shortcut.id}`);
    else seen.set(key, shortcut.id);
  }
  return duplicates;
}
