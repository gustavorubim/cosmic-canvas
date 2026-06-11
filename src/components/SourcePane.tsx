import { useEffect, useRef } from "react";
import { PanelLeftOpen } from "lucide-react";
import { basicSetup } from "codemirror";
import { html } from "@codemirror/lang-html";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type SourcePaneProps = {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onShow: () => void;
};

export function SourcePane({ value, onChange, visible, onShow }: SourcePaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

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

  if (!visible) {
    return (
      <aside className="source-rail" aria-label="Collapsed HTML source">
        <button aria-label="Show HTML source" onClick={onShow} title="Show HTML source" type="button">
          <PanelLeftOpen size={18} aria-hidden="true" />
          <span>HTML</span>
        </button>
        <span>{value.length.toLocaleString()}</span>
      </aside>
    );
  }

  return (
    <aside className="source-pane" aria-label="HTML source">
      <div className="pane-title">
        <span>HTML source</span>
        <span>{value.length.toLocaleString()} chars</span>
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
