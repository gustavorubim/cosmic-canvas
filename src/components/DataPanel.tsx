import { BarChart3, LineChart, PieChart, Plus, Table2 } from "lucide-react";
import { type ChartType } from "../protocol";

type DataPanelProps = {
  dataTitle: string;
  onTitle: (value: string) => void;
  dataText: string;
  onDataText: (value: string) => void;
  dataRows: string[][];
  dataColumnCount: number;
  onUpdateCell: (rowIndex: number, cellIndex: number, value: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onInsert: () => void;
  onInsertChart: (type: ChartType) => void;
};

export function DataPanel({
  dataTitle,
  onTitle,
  dataText,
  onDataText,
  dataRows,
  dataColumnCount,
  onUpdateCell,
  onAddRow,
  onAddColumn,
  onInsert,
  onInsertChart,
}: DataPanelProps) {
  return (
    <div className="data-panel">
      <label>
        Title
        <input value={dataTitle} onChange={(event) => onTitle(event.target.value)} />
      </label>

      <label>
        CSV
        <textarea
          className="data-textarea"
          spellCheck={false}
          value={dataText}
          onChange={(event) => onDataText(event.target.value)}
        />
      </label>

      <div className="data-actions">
        <button type="button" onClick={onAddRow} title="Add row">
          <Plus size={16} aria-hidden="true" />
          Row
        </button>
        <button type="button" onClick={onAddColumn} title="Add column">
          <Plus size={16} aria-hidden="true" />
          Column
        </button>
        <button className="primary" type="button" onClick={onInsert} title="Insert data table">
          <Table2 size={16} aria-hidden="true" />
          Table
        </button>
        <button type="button" onClick={() => onInsertChart("bar")} title="Insert bar chart">
          <BarChart3 size={16} aria-hidden="true" />
          Bar
        </button>
        <button type="button" onClick={() => onInsertChart("line")} title="Insert line chart">
          <LineChart size={16} aria-hidden="true" />
          Line
        </button>
        <button type="button" onClick={() => onInsertChart("pie")} title="Insert pie chart">
          <PieChart size={16} aria-hidden="true" />
          Pie
        </button>
      </div>

      <div className="data-grid" aria-label="Data table editor">
        {dataRows.map((row, rowIndex) => (
          <div
            className={`data-grid-row ${rowIndex === 0 ? "is-header" : ""}`}
            key={`row-${rowIndex}`}
            style={{ gridTemplateColumns: `repeat(${dataColumnCount}, minmax(88px, 1fr))` }}
          >
            {row.map((cell, cellIndex) => (
              <input
                aria-label={`Row ${rowIndex + 1} column ${cellIndex + 1}`}
                key={`cell-${rowIndex}-${cellIndex}`}
                onChange={(event) => onUpdateCell(rowIndex, cellIndex, event.target.value)}
                value={cell}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
