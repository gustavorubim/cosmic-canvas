import { Keyboard } from "lucide-react";
import { shortcutMapRows } from "../shortcuts";

export function ShortcutPanel() {
  const rows = shortcutMapRows();

  return (
    <div className="shortcut-panel">
      <div className="shortcut-list" aria-label="Keyboard shortcuts">
        {rows.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.id}>
            <span>
              <Keyboard size={15} aria-hidden="true" />
              <strong>{shortcut.label}</strong>
              <em>{shortcut.when}</em>
            </span>
            <kbd>{shortcut.binding}</kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
