import { ChevronLeft, ChevronRight, CopyPlus, Layers3, Plus } from "lucide-react";
import { type DeckSlide } from "../protocol";

type DeckTimelineProps = {
  slides: DeckSlide[];
  activeSlideId: string;
  activeSlideIndex: number;
  onGoSlide: (slide: DeckSlide) => void;
  onStep: (offset: number) => void;
  onDuplicate: () => void;
  onInsert: () => void;
};

export function DeckTimeline({
  slides,
  activeSlideId,
  activeSlideIndex,
  onGoSlide,
  onStep,
  onDuplicate,
  onInsert,
}: DeckTimelineProps) {
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
        </div>
      </div>
      <div className="slide-strip">
        {slides.map((slide) => (
          <button
            className={slide.id === activeSlideId ? "is-active" : ""}
            key={slide.id}
            onClick={() => onGoSlide(slide)}
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
