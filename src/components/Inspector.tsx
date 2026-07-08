import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CopyPlus,
  CornerLeftUp,
  Heading2,
  ImageUp,
  MousePointer2,
  Plus,
  Square,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type SelectedElement } from "../protocol";

const alignButtons = [
  { label: "Left", value: "left", icon: AlignLeft },
  { label: "Center", value: "center", icon: AlignCenter },
  { label: "Right", value: "right", icon: AlignRight },
];

const insertButtons = [
  { kind: "heading", label: "Heading", icon: Heading2 },
  { kind: "paragraph", label: "Text", icon: Type },
  { kind: "image", label: "Image", icon: ImageUp },
  { kind: "button", label: "Button", icon: MousePointer2 },
  { kind: "box", label: "Box", icon: Square },
] as const;

function numberFromCss(value: string, fallback = "") {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? match[0] : fallback;
}

function fallbackColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

type ColorFieldProps = {
  label: string;
  value: string;
  swatchFallback: string;
  onChange: (value: string) => void;
};

/** Swatch + free-text pair so non-hex values (rgba, var(), named) round-trip. */
function ColorField({ label, value, swatchFallback, onChange }: ColorFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label>
      {label}
      <div className="color-field">
        <input
          aria-label={`${label} swatch`}
          type="color"
          value={fallbackColor(value, swatchFallback)}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          aria-label={`${label} value`}
          className="color-text"
          placeholder="auto"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft !== value && onChange(draft)}
          onKeyDown={(event) => event.key === "Enter" && onChange(draft)}
        />
      </div>
    </label>
  );
}

type InspectorProps = {
  selected: SelectedElement;
  onText: (text: string) => void;
  onStyle: (styles: Record<string, string>) => void;
  onSelectParent: () => void;
  onAddClass: (name: string) => void;
  onRemoveClass: (name: string) => void;
  onReplaceImage: (src: string, alt?: string) => void;
  onNudge: (dx: number, dy: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onInsertElement: (kind: (typeof insertButtons)[number]["kind"]) => void;
};

export function Inspector({
  selected,
  onText,
  onStyle,
  onSelectParent,
  onAddClass,
  onRemoveClass,
  onReplaceImage,
  onNudge,
  onDuplicate,
  onDelete,
  onInsertElement,
}: InspectorProps) {
  const [classDraft, setClassDraft] = useState("");
  const [imageUrl, setImageUrl] = useState(selected.imageSrc);
  const imageFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setImageUrl(selected.imageSrc), [selected.id, selected.imageSrc]);

  function submitClass() {
    const name = classDraft.trim();
    if (!name) return;
    onAddClass(name);
    setClassDraft("");
  }

  function onClassKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitClass();
    }
  }

  async function onImageFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    onReplaceImage(dataUrl);
  }

  return (
    <div className="inspector-body">
      <details className="inspector-group" open>
        <summary>Content</summary>
        <label>
          Text
          {selected.editableText ? (
            <textarea
              className="text-control"
              value={selected.text}
              onChange={(event) => onText(event.target.value)}
            />
          ) : (
            <div className="field-note">
              This element wraps {selected.childElementCount} child element
              {selected.childElementCount === 1 ? "" : "s"}. Select a leaf element to edit its text,
              or use the breadcrumb under the canvas to move around.
            </div>
          )}
        </label>
      </details>

      <details className="inspector-group" open>
        <summary>Insert</summary>
        <div className="insert-grid" aria-label="Insert element">
          {insertButtons.map(({ kind, label, icon: Icon }) => (
            <button key={kind} onClick={() => onInsertElement(kind)} title={`Insert ${label}`} type="button">
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </details>

      <details className="inspector-group" open>
        <summary>Classes</summary>
        <div className="class-editor">
          <div className="class-chips">
            {selected.classes.length === 0 ? <em className="muted">No classes</em> : null}
            {selected.classes.map((name) => (
              <span className="class-chip" key={name}>
                {name}
                <button aria-label={`Remove class ${name}`} onClick={() => onRemoveClass(name)} type="button">
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <div className="class-add">
            <input
              aria-label="Add class"
              placeholder="add-class"
              value={classDraft}
              onChange={(event) => setClassDraft(event.target.value)}
              onKeyDown={onClassKeyDown}
            />
            <button onClick={submitClass} title="Add class" type="button">
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </details>

      {selected.isImage ? (
        <details className="inspector-group" open>
          <summary>Image</summary>
          <div className="image-editor">
            <div className="image-row">
              <input
                aria-label="Image URL"
                placeholder="https:// or data:"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && onReplaceImage(imageUrl)}
              />
              <button onClick={() => onReplaceImage(imageUrl)} title="Apply image URL" type="button">
                Set
              </button>
            </div>
            <input
              ref={imageFileRef}
              accept="image/*"
              className="file-input"
              onChange={onImageFile}
              type="file"
            />
            <button className="image-upload" onClick={() => imageFileRef.current?.click()} type="button">
              <ImageUp size={15} aria-hidden="true" />
              Replace from file
            </button>
          </div>
        </details>
      ) : null}

      <details className="inspector-group" open>
        <summary>Style</summary>
        <div className="field-grid">
          <ColorField
            label="Text color"
            value={selected.styles.color}
            swatchFallback="#1f2933"
            onChange={(value) => onStyle({ color: value })}
          />
          <ColorField
            label="Fill"
            value={selected.styles.backgroundColor}
            swatchFallback="#ffffff"
            onChange={(value) => onStyle({ backgroundColor: value })}
          />
          <label>
            Font size
            <input
              min="8"
              max="180"
              type="number"
              value={numberFromCss(selected.styles.fontSize, "16")}
              onChange={(event) => onStyle({ fontSize: `${event.target.value}px` })}
            />
          </label>
          <label>
            Radius
            <input
              min="0"
              max="80"
              type="number"
              value={numberFromCss(selected.styles.borderRadius, "0")}
              onChange={(event) => onStyle({ borderRadius: `${event.target.value}px` })}
            />
          </label>
        </div>

        <div className="align-row" aria-label="Text alignment">
          {alignButtons.map(({ label, value, icon: Icon }) => (
            <button
              aria-label={label}
              aria-pressed={selected.styles.textAlign === value}
              className={selected.styles.textAlign === value ? "is-active" : ""}
              key={value}
              onClick={() => onStyle({ textAlign: value })}
              title={label}
              type="button"
            >
              <Icon size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
      </details>

      <details className="inspector-group" open>
        <summary>Layout</summary>
        <div className="field-stack">
          <label>
            Padding
            <input
              value={selected.styles.padding}
              onChange={(event) => onStyle({ padding: event.target.value })}
            />
          </label>
          <label>
            Margin
            <input
              value={selected.styles.margin}
              onChange={(event) => onStyle({ margin: event.target.value })}
            />
          </label>
          <label>
            Width
            <input
              value={selected.styles.width}
              onChange={(event) => onStyle({ width: event.target.value })}
            />
          </label>
          <label>
            Height
            <input
              value={selected.styles.height}
              onChange={(event) => onStyle({ height: event.target.value })}
            />
          </label>
        </div>

        <div className="nudge-grid" aria-label="Move controls">
          <button type="button" onClick={() => onNudge(0, -8)}>
            Up
          </button>
          <button type="button" onClick={() => onNudge(-8, 0)}>
            Left
          </button>
          <button type="button" onClick={() => onNudge(8, 0)}>
            Right
          </button>
          <button type="button" onClick={() => onNudge(0, 8)}>
            Down
          </button>
        </div>
      </details>

      <div className="inspector-actions">
        <button type="button" onClick={onSelectParent} title="Select parent element">
          <CornerLeftUp size={16} aria-hidden="true" />
          Parent
        </button>
        <button type="button" onClick={onDuplicate}>
          <CopyPlus size={16} aria-hidden="true" />
          Duplicate
        </button>
        <button className="danger" type="button" onClick={onDelete}>
          <Trash2 size={16} aria-hidden="true" />
          Delete
        </button>
      </div>
    </div>
  );
}

export function InspectorEmpty() {
  return (
    <div className="empty-state">
      <MousePointer2 size={28} aria-hidden="true" />
      <span>No element selected</span>
      <small>Click any element in the canvas to inspect and style it.</small>
    </div>
  );
}
