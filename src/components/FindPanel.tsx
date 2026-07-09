import { Search } from "lucide-react";
import { type KeyboardEvent } from "react";

type FindPanelProps = {
  query: string;
  replacement: string;
  count: number;
  onQuery: (value: string) => void;
  onReplacement: (value: string) => void;
  onFind: () => void;
  onReplace: () => void;
};

export function FindPanel({
  query,
  replacement,
  count,
  onQuery,
  onReplacement,
  onFind,
  onReplace,
}: FindPanelProps) {
  function onFindKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") onFind();
  }

  function onReplaceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") onReplace();
  }

  return (
    <div className="find-panel">
      <label>
        Find
        <input
          aria-label="Find text"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onFindKeyDown}
        />
      </label>
      <label>
        Replace
        <input
          aria-label="Replace text"
          value={replacement}
          onChange={(event) => onReplacement(event.target.value)}
          onKeyDown={onReplaceKeyDown}
        />
      </label>
      <div className="find-actions">
        <button className="primary" type="button" onClick={onFind}>
          <Search size={16} aria-hidden="true" />
          Find
        </button>
        <button type="button" onClick={onReplace}>
          Replace
        </button>
      </div>
      <small>{count} matches</small>
    </div>
  );
}
