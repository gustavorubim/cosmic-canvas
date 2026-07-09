import { RotateCcw, Save } from "lucide-react";
import { type Checkpoint } from "../checkpoints";

type CheckpointPanelProps = {
  checkpoints: Checkpoint[];
  name: string;
  onName: (value: string) => void;
  onCreate: () => void;
  onRestore: (id: string) => void;
};

export function CheckpointPanel({
  checkpoints,
  name,
  onName,
  onCreate,
  onRestore,
}: CheckpointPanelProps) {
  return (
    <div className="checkpoint-panel">
      <label>
        Snapshot name
        <input
          onChange={(event) => onName(event.target.value)}
          placeholder="Before cleanup"
          value={name}
        />
      </label>
      <button className="checkpoint-create" onClick={onCreate} type="button">
        <Save size={16} aria-hidden="true" />
        Create checkpoint
      </button>

      <div className="checkpoint-list" aria-label="Saved checkpoints">
        {checkpoints.length === 0 ? <small>No checkpoints yet</small> : null}
        {checkpoints.map((checkpoint) => (
          <button key={checkpoint.id} onClick={() => onRestore(checkpoint.id)} type="button">
            <span>
              <strong>{checkpoint.name}</strong>
              <em>{new Date(checkpoint.createdAt).toLocaleString()}</em>
            </span>
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
