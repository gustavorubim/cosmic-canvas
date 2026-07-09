import { useEffect, useRef } from "react";
import { PanelLeftOpen } from "lucide-react";
import { basicSetup } from "codemirror";
import { html } from "@codemirror/lang-html";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { type SelectedElement } from "../protocol";
import { findOpeningTagLocation, sourceNeedleForSelected } from "../sourceSync";

const setFlashLine = StateEffect.define<number | null>();

const flashLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setFlashLine)) {
        next =
          effect.value === null
            ? Decoration.none
            : Decoration.set([Decoration.line({ class: "cm-source-sync-line" }).range(effect.value)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export type SourcePaneProps = {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onShow: () => void;
  dirty: boolean;
  onApply: () => void;
  selected: SelectedElement | null;
};

export function SourcePane({ value, onChange, visible, onShow, dirty, onApply, selected }: SourcePaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const flashTimerRef = useRef<number>();

  // Keep a ref to the latest onChange so the updateListener always calls the
  // current callback without needing to recreate the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Track the latest value so we can seed the editor with the correct content
  // when it is (re)created on becoming visible, without recreating on every
  // value change.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Create the editor on mount / when toggling back to visible; destroy on cleanup.
  useEffect(() => {
    if (!visible || !hostRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        basicSetup,
        html(),
        EditorView.lineWrapping,
        flashLineField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, [visible]);

  // Reflect external value changes into the editor without clobbering the cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    const location = findOpeningTagLocation(value, selected);
    if (!view || !location) return;

    const line = view.state.doc.line(location.lineNumber);
    view.dispatch({
      selection: { anchor: location.from },
      effects: [
        EditorView.scrollIntoView(location.from, { y: "center" }),
        setFlashLine.of(line.from),
      ],
    });

    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      viewRef.current?.dispatch({ effects: setFlashLine.of(null) });
    }, 1000);
  }, [selected?.id, selected?.domId, selected?.tagName, selected?.classes.join(" "), visible]);

  if (!visible) {
    return (
      <aside className="source-rail" aria-label="Collapsed HTML source">
        <button aria-label="Show HTML source" onClick={onShow} title="Show HTML source" type="button">
          <PanelLeftOpen size={18} aria-hidden="true" />
          <span>HTML</span>
          {dirty ? <i className="rail-dot" title="Source modified - not applied" /> : null}
        </button>
        <span>{value.length.toLocaleString()}</span>
      </aside>
    );
  }

  return (
    <aside className="source-pane" aria-label="HTML source">
      <div className="pane-title">
        <span>HTML source</span>
        <span className="source-meta">
          {selected ? <small title={sourceNeedleForSelected(selected)}>Synced</small> : null}
          {dirty ? (
            <button
              className="apply-chip"
              onClick={onApply}
              title="Render the edited source in the canvas (Ctrl+Enter)"
              type="button"
            >
              Modified - Apply
            </button>
          ) : null}
          {value.length.toLocaleString()} chars
        </span>
      </div>
      <div
        ref={hostRef}
        className="cm-host"
        aria-label="HTML source editor"
        style={{ height: "100%", minHeight: 0, overflow: "hidden" }}
      />
    </aside>
  );
}
