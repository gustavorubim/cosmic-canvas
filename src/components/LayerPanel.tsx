import { BringToFront, SendToBack } from "lucide-react";
import { type LayerItem, type ZOrderAction } from "../protocol";

type LayerPanelProps = {
  layers: LayerItem[];
  onSelect: (id: string) => void;
  onZOrder: (action: ZOrderAction) => void;
};

export function LayerPanel({ layers, onSelect, onZOrder }: LayerPanelProps) {
  return (
    <div className="layer-panel">
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
      <div className="layer-list" aria-label="Layers">
        {layers.length === 0 ? <small>No sibling layers</small> : null}
        {layers.map((layer) => (
          <button
            aria-pressed={layer.active}
            className={layer.active ? "is-active" : ""}
            key={layer.id}
            onClick={() => onSelect(layer.id)}
            type="button"
          >
            <strong>{layer.label}</strong>
            <em>{layer.zIndex === "auto" ? "auto" : `z ${layer.zIndex}`}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
