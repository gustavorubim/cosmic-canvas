import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Layers3,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
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

type DeckTimelineProps = {
  slides: DeckSlide[];
  activeSlideId: string;
  activeSlideIndex: number;
  onGoSlide: (slide: DeckSlide) => void;
  onStep: (offset: number) => void;
  onDuplicate: () => void;
  onInsert: () => void;
  onRename: (slide: DeckSlide, title: string) => void;
  onDelete: () => void;
  onMove: (offset: number) => void;
  onTemplate: (template: SlideTemplateKind) => void;
};

export function DeckTimeline({
  slides,
  activeSlideId,
  activeSlideIndex,
  onGoSlide,
  onStep,
  onDuplicate,
  onInsert,
  onRename,
  onDelete,
  onMove,
  onTemplate,
}: DeckTimelineProps) {
  const [template, setTemplate] = useState<SlideTemplateKind>("title");

  function requestRename(slide: DeckSlide) {
    const title = window.prompt("Rename slide", slide.title);
    if (title === null) return;
    onRename(slide, title);
  }

  return (
    <div className="deck-timeline" aria-label="Slide timeline">
      <div className="timeline-header">
        <div>
          <span>Timeline</span>
          <strong>
            {activeSlideIndex + 1} / {slides.length}
          </strong>
        </div>
        <div className="timeline-actions">
          <button
            disabled={activeSlideIndex <= 0}
            onClick={() => onStep(-1)}
            title="Previous slide"
            type="button"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            disabled={activeSlideIndex >= slides.length - 1}
            onClick={() => onStep(1)}
            title="Next slide"
            type="button"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button onClick={onDuplicate} title="Duplicate current slide" type="button">
            <CopyPlus size={16} aria-hidden="true" />
          </button>
          <button onClick={onInsert} title="Insert slide after current" type="button">
            <Plus size={16} aria-hidden="true" />
          </button>
          <div className="template-picker">
            <select
              aria-label="Slide template"
              onChange={(event) => setTemplate(event.target.value as SlideTemplateKind)}
              value={template}
            >
              {slideTemplateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              aria-label="Insert selected template"
              onClick={() => onTemplate(template)}
              title="Insert selected template"
              type="button"
            >
              <Layers3 size={16} aria-hidden="true" />
            </button>
          </div>
          <button
            disabled={activeSlideIndex <= 0}
            onClick={() => onMove(-1)}
            title="Move current slide left"
            type="button"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <button
            disabled={activeSlideIndex >= slides.length - 1}
            onClick={() => onMove(1)}
            title="Move current slide right"
            type="button"
          >
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button disabled={slides.length <= 1} onClick={onDelete} title="Delete current slide" type="button">
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="slide-strip">
        {slides.map((slide) => (
          <button
            className={slide.id === activeSlideId ? "is-active" : ""}
            key={slide.id}
            onClick={() => onGoSlide(slide)}
            onDoubleClick={() => requestRename(slide)}
            title={slide.title}
            type="button"
          >
            <span>{slide.index + 1}</span>
            <strong>{slide.title}</strong>
            {slide.section ? <em>{slide.section}</em> : null}
          </button>
        ))}
        <button className="slide-add" onClick={onInsert} title="Insert slide after current" type="button">
          <Layers3 size={18} aria-hidden="true" />
          <strong>New slide</strong>
        </button>
      </div>
    </div>
  );
}
