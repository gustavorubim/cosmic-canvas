export const DEFAULT_DATA_ROWS: string[][] = [
  ["Metric", "Value", "Change"],
  ["Revenue", "$4.2M", "+18%"],
  ["Retention", "91%", "+6 pts"],
  ["Pipeline", "$12.4M", "+22%"],
];

/**
 * Pad every row to a rectangular shape and drop fully empty rows. Falls back to
 * the default sample when no row has any content so the editor always has a grid
 * to render.
 */
export function normalizeDataRows(rows: string[][]): string[][] {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  const sourceRows = nonEmptyRows.length ? nonEmptyRows : DEFAULT_DATA_ROWS;
  const width = Math.max(2, ...sourceRows.map((row) => row.length));
  return sourceRows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? ""),
  );
}

/**
 * Parse delimited text into a normalized grid. Auto-detects tab vs comma and
 * honours RFC-4180-style double-quoted cells (including escaped quotes).
 */
export function parseDataText(text: string): string[][] {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && next === "\n") index += 1;
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  rows.push(row);
  return normalizeDataRows(rows);
}

/** Serialize a grid back to CSV, quoting only cells that need it. */
export function serializeDataRows(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (!/[",\n\r]/.test(cell)) return cell;
          return `"${cell.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
}
