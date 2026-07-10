import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import type { DeckDetectionMode } from "../deckPreferences";
import { type DeckSlide, type SlideTemplateKind } from "../protocol";

const slideTemplateOptions: Array<{ value: SlideTemplateKind; label: string }> = [
  { value: "title", label: "Title" },
  { value: "section", label: "Section" },
  { value: "quote", label: "Quote" },
  { value: "image-text", label: "Image + text" },
  { value: "metrics", label: "Metrics" },
  { value: "agenda", label: "Agenda" },
  { value: "closing", label: "Closing" },
];

type DeckNavigatorProps = {
  slides: DeckSlide[];
  activeSlideId: string;
  activeSlideIndex: number;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  onForceTimeline: () => void;
  detectionMode: DeckDetectionMode;
  selector: string;
  canUseSelection: boolean;
  selectedIsMarked: boolean;
  onApplySelector: (selector: string) => void;
  onUseSelectedSiblings: () => void;
  onToggleSelectedPage: () => void;
  onAutomaticDetection: () => void;
  onGoSlide: (slide: DeckSlide) => void;
  onStep: (offset: number) => void;
  onDuplicate: () => void;
  onInsert: () => void;
  onRename: (slide: DeckSlide, title: string) => void;
  onDelete: () => void;
  onMove: (offset: number) => void;
  onTemplate: (template: SlideTemplateKind) => void;
};

export function DeckNavigator({
  slides,
  activeSlideId,
  activeSlideIndex,
  collapsed,
  onCollapsed,
  onForceTimeline,
  detectionMode,
  selector,
  canUseSelection,
  selectedIsMarked,
  onApplySelector,
  onUseSelectedSiblings,
  onToggleSelectedPage,
  onAutomaticDetection,
  onGoSlide,
  onStep,
  onDuplicate,
  onInsert,
  onRename,
  onDelete,
  onMove,
  onTemplate,
}: DeckNavigatorProps) {
  const [template, setTemplate] = useState<SlideTemplateKind>("title");
  const [selectorDraft, setSelectorDraft] = useState(selector);
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const virtualized = slides.length > 24;
  const rowHeight = 139;
  const viewportRows = Math.ceil((listRef.current?.clientHeight || 600) / rowHeight);
  const startIndex = virtualized ? Math.max(0, Math.floor(scrollTop / rowHeight) - 3) : 0;
  const endIndex = virtualized ? Math.min(slides.length, startIndex + viewportRows + 6) : slides.length;
  const visibleSlides = slides.slice(startIndex, endIndex);

  useEffect(() => setSelectorDraft(selector), [selector]);

  useEffect(() => {
    if (!virtualized || activeSlideIndex < 0 || !listRef.current) return;
    const top = activeSlideIndex * rowHeight;
    const bottom = top + rowHeight;
    const viewportTop = listRef.current.scrollTop;
    const viewportBottom = viewportTop + listRef.current.clientHeight;
    if (top < viewportTop || bottom > viewportBottom) {
      listRef.current.scrollTo({ top: Math.max(0, top - rowHeight), behavior: "smooth" });
    }
  }, [activeSlideIndex, virtualized]);

  function updateVirtualWindow(event: UIEvent<HTMLDivElement>) {
    if (virtualized) setScrollTop(event.currentTarget.scrollTop);
  }

  function requestRename(slide: DeckSlide) {
    const title = window.prompt("Rename slide", slide.title);
    if (title !== null) onRename(slide, title);
  }

  if (collapsed) {
    return (
      <aside className="deck-navigator is-collapsed" aria-label="Document navigator">
        <button
          aria-label="Expand document navigator"
          className="navigator-expand"
          onClick={() => onCollapsed(false)}
          title="Expand document navigator"
          type="button"
        >
          <PanelLeftOpen size={18} aria-hidden="true" />
          <span>{slides.length || "Pages"}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="deck-navigator" aria-label="Document navigator">
      <header className="navigator-header">
        <div>
          <strong>Pages</strong>
          <span>{slides.length ? `${activeSlideIndex + 1} / ${slides.length}` : "Not detected"}</span>
        </div>
        <button aria-label="Collapse document navigator" onClick={() => onCollapsed(true)} type="button">
          <PanelLeftClose size={17} aria-hidden="true" />
        </button>
      </header>

      <details className="navigator-detection" open={!slides.length}>
        <summary>Page detection: {detectionMode}</summary>
        <div>
          <label htmlFor="deck-selector">CSS selector</label>
          <span>
            <input
              id="deck-selector"
              onChange={(event) => setSelectorDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onApplySelector(selectorDraft);
              }}
              placeholder=".slide, [data-page]"
              value={selectorDraft}
            />
            <button onClick={() => onApplySelector(selectorDraft)} type="button">Apply</button>
          </span>
          <button disabled={!canUseSelection} onClick={onUseSelectedSiblings} type="button">
            Use selected element's siblings
          </button>
          <button disabled={!canUseSelection} onClick={onToggleSelectedPage} type="button">
            {selectedIsMarked ? "Unmark selected page" : "Mark selected as page"}
          </button>
          <button onClick={onAutomaticDetection} type="button">Reset to automatic</button>
        </div>
      </details>

      {slides.length ? (
        <>
          <div className="navigator-actions" aria-label="Page navigation controls">
            <button disabled={activeSlideIndex <= 0} onClick={() => onStep(-1)} title="Previous page" type="button">
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              disabled={activeSlideIndex >= slides.length - 1}
              onClick={() => onStep(1)}
              title="Next page"
              type="button"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button onClick={onDuplicate} title="Duplicate current page" type="button">
              <CopyPlus size={16} aria-hidden="true" />
            </button>
            <button onClick={onInsert} title="Insert page after current" type="button">
              <Plus size={16} aria-hidden="true" />
            </button>
            <button disabled={activeSlideIndex <= 0} onClick={() => onMove(-1)} title="Move page up" type="button">
              <ArrowUp size={16} aria-hidden="true" />
            </button>
            <button
              disabled={activeSlideIndex >= slides.length - 1}
              onClick={() => onMove(1)}
              title="Move page down"
              type="button"
            >
              <ArrowDown size={16} aria-hidden="true" />
            </button>
            <button disabled={slides.length <= 1} onClick={onDelete} title="Delete current page" type="button">
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="navigator-template">
            <label>
              Template
              <span>
                <select
                  aria-label="Page template"
                  onChange={(event) => setTemplate(event.target.value as SlideTemplateKind)}
                  value={template}
                >
                  {slideTemplateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button aria-label="Insert selected page template" onClick={() => onTemplate(template)} type="button">
                  <Layers3 size={16} aria-hidden="true" />
                </button>
              </span>
            </label>
          </div>

          <div
            className="navigator-slide-list"
            aria-label="Pages"
            data-total-pages={slides.length}
            onScroll={updateVirtualWindow}
            ref={listRef}
          >
            {virtualized && startIndex > 0 ? (
              <div aria-hidden="true" className="navigator-virtual-spacer" style={{ height: startIndex * rowHeight }} />
            ) : null}
            {visibleSlides.map((slide) => (
              <button
                aria-current={slide.id === activeSlideId ? "page" : undefined}
                className={slide.id === activeSlideId ? "is-active" : ""}
                key={slide.id}
                onClick={() => onGoSlide(slide)}
                onDoubleClick={() => requestRename(slide)}
                title={`${slide.index + 1}. ${slide.title}`}
                type="button"
              >
                <span className="navigator-index">{slide.index + 1}</span>
                <div
                  aria-hidden="true"
                  className="navigator-thumbnail"
                  dangerouslySetInnerHTML={{ __html: slide.thumbnailHtml }}
                />
                <strong>{slide.title}</strong>
                {slide.section ? <em>{slide.section}</em> : null}
              </button>
            ))}
            {virtualized && endIndex < slides.length ? (
              <div
                aria-hidden="true"
                className="navigator-virtual-spacer"
                style={{ height: (slides.length - endIndex) * rowHeight }}
              />
            ) : null}
            <button className="navigator-add" onClick={onInsert} type="button">
              <Plus size={17} aria-hidden="true" />
              New page
            </button>
          </div>
        </>
      ) : (
        <div className="navigator-empty">
          <Layers3 size={24} aria-hidden="true" />
          <strong>No pages detected</strong>
          <span>Try structural inference for repeated page-like content.</span>
          <button onClick={onForceTimeline} type="button">
            Run forced detection
          </button>
        </div>
      )}
    </aside>
  );
}
