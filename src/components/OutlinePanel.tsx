import { BringToFront, Eye, EyeOff, Lock, LockOpen, MousePointer2, SendToBack, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import type { OutlineItem, ZOrderAction } from "../protocol";

type OutlinePanelProps = {
  items: OutlineItem[];
  truncated: boolean;
  onSelect: (id: string) => void;
  onHidden: (item: OutlineItem, enabled: boolean) => void;
  onLocked: (item: OutlineItem, enabled: boolean) => void;
  onPickThrough: (item: OutlineItem, enabled: boolean) => void;
  onZOrder: (action: ZOrderAction) => void;
};

export function OutlinePanel({
  items,
  truncated,
  onSelect,
  onHidden,
  onLocked,
  onPickThrough,
  onZOrder,
}: OutlinePanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 34;
  const virtualized = items.length > 100;
  const viewportRows = Math.ceil((listRef.current?.clientHeight || 560) / rowHeight);
  const start = virtualized ? Math.max(0, Math.floor(scrollTop / rowHeight) - 5) : 0;
  const end = virtualized ? Math.min(items.length, start + viewportRows + 10) : items.length;
  const visible = items.slice(start, end);
  const activeIndex = items.findIndex((item) => item.active);

  useEffect(() => {
    if (!virtualized || activeIndex < 0 || !listRef.current) return;
    const top = activeIndex * rowHeight;
    const bottom = top + rowHeight;
    if (top < listRef.current.scrollTop || bottom > listRef.current.scrollTop + listRef.current.clientHeight) {
      listRef.current.scrollTo({ top: Math.max(0, top - rowHeight * 2), behavior: "smooth" });
    }
  }, [activeIndex, virtualized]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (virtualized) setScrollTop(event.currentTarget.scrollTop);
  }

  return (
    <div className="outline-panel">
      <div className="layer-actions" aria-label="Z order controls">
        <button type="button" onClick={() => onZOrder("bring-forward")}>
          <BringToFront size={16} aria-hidden="true" />
          Forward
        </button>
        <button type="button" onClick={() => onZOrder("send-backward")}>
          <SendToBack size={16} aria-hidden="true" />
          Back
        </button>
      </div>
      <p className="outline-help">Click to select. Alt-click the canvas to climb through ancestors.</p>
      <div className="outline-list" aria-label="Document outline" onScroll={onScroll} ref={listRef}>
        {items.length === 0 ? <small>No document elements</small> : null}
        {start > 0 ? <div aria-hidden="true" style={{ height: start * rowHeight }} /> : null}
        {visible.map((item) => (
          <div
            className={`outline-row ${item.active ? "is-active" : ""}`}
            key={item.id}
            style={{ paddingLeft: Math.min(12, item.depth) * 12 + 5 }}
          >
            <button
              aria-current={item.active ? "true" : undefined}
              className="outline-select"
              onClick={() => onSelect(item.id)}
              title={item.label}
              type="button"
            >
              <span aria-hidden="true">{item.hasChildren ? "▾" : "·"}</span>
              {item.label}
            </button>
            <button
              aria-label={`${item.hidden ? "Show" : "Hide"} ${item.label}`}
              onClick={() => onHidden(item, !item.hidden)}
              title={item.hidden ? "Show in editor" : "Hide in editor"}
              type="button"
            >
              {item.hidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
            <button
              aria-label={`${item.locked ? "Unlock" : "Lock"} ${item.label}`}
              onClick={() => onLocked(item, !item.locked)}
              title={item.locked ? "Unlock selection" : "Lock selection"}
              type="button"
            >
              {item.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
            </button>
            <button
              aria-label={`${item.pickThrough ? "Restore picking" : "Ignore overlay"} ${item.label}`}
              onClick={() => onPickThrough(item, !item.pickThrough)}
              title={item.pickThrough ? "Restore normal picking" : "Ignore this overlay for picking"}
              type="button"
            >
              {item.pickThrough ? <Undo2 size={14} aria-hidden="true" /> : <MousePointer2 size={14} aria-hidden="true" />}
            </button>
          </div>
        ))}
        {end < items.length ? <div aria-hidden="true" style={{ height: (items.length - end) * rowHeight }} /> : null}
      </div>
      {truncated ? <small className="outline-warning">Outline limited to the first 5,000 elements.</small> : null}
    </div>
  );
}
