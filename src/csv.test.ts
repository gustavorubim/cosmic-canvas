import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA_ROWS,
  normalizeDataRows,
  parseDataText,
  serializeDataRows,
} from "./csv";

describe("parseDataText", () => {
  it("auto-detects comma delimiter", () => {
    const result = parseDataText("a,b,c\n1,2,3");
    expect(result).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("auto-detects tab delimiter when a tab is present", () => {
    const result = parseDataText("a\tb\tc\n1\t2\t3");
    expect(result).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("parses quoted cells with embedded commas", () => {
    const result = parseDataText('name,note\n"Doe, John",hello');
    expect(result).toEqual([
      ["name", "note"],
      ["Doe, John", "hello"],
    ]);
  });

  it("parses escaped double-quotes within quoted cells", () => {
    const result = parseDataText('label,value\n"She said ""hi""",ok');
    expect(result).toEqual([
      ["label", "value"],
      ['She said "hi"', "ok"],
    ]);
  });

  it("handles LF line endings", () => {
    const result = parseDataText("a,b\nc,d");
    expect(result).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles CRLF line endings", () => {
    const result = parseDataText("a,b\r\nc,d");
    expect(result).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("falls back to DEFAULT_DATA_ROWS for empty input", () => {
    expect(parseDataText("")).toEqual(normalizeDataRows(DEFAULT_DATA_ROWS));
  });

  it("falls back to DEFAULT_DATA_ROWS for whitespace-only input", () => {
    expect(parseDataText("   \n  \n")).toEqual(
      normalizeDataRows(DEFAULT_DATA_ROWS),
    );
  });
});

describe("normalizeDataRows", () => {
  it("pads rows to a rectangular width", () => {
    const result = normalizeDataRows([["a", "b", "c"], ["d"]]);
    expect(result).toEqual([
      ["a", "b", "c"],
      ["d", "", ""],
    ]);
    expect(result.every((row) => row.length === 3)).toBe(true);
  });

  it("enforces a minimum width of 2", () => {
    const result = normalizeDataRows([["solo"]]);
    expect(result).toEqual([["solo", ""]]);
  });

  it("drops fully-empty rows", () => {
    const result = normalizeDataRows([
      ["a", "b"],
      ["", "   "],
      ["c", "d"],
    ]);
    expect(result).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("falls back to DEFAULT_DATA_ROWS when every row is empty", () => {
    expect(normalizeDataRows([["", ""], ["  "]])).toEqual(
      normalizeDataRows(DEFAULT_DATA_ROWS),
    );
  });
});

describe("serializeDataRows", () => {
  it("does not quote plain cells", () => {
    expect(serializeDataRows([["a", "b"], ["c", "d"]])).toBe("a,b\nc,d");
  });

  it("quotes cells containing a comma", () => {
    expect(serializeDataRows([["Doe, John", "x"]])).toBe('"Doe, John",x');
  });

  it("quotes and escapes cells containing a double-quote", () => {
    expect(serializeDataRows([['say "hi"', "x"]])).toBe('"say ""hi""",x');
  });

  it("quotes cells containing a newline", () => {
    expect(serializeDataRows([["line1\nline2", "x"]])).toBe('"line1\nline2",x');
  });
});

describe("round-trip", () => {
  it("parseDataText(serializeDataRows(rows)) returns an equivalent normalized grid", () => {
    const rows = [
      ["Metric", "Value"],
      ["Revenue", "$4.2M"],
      ["Retention", "91%"],
    ];
    const normalized = normalizeDataRows(rows);
    const roundTripped = parseDataText(serializeDataRows(normalized));
    expect(roundTripped).toEqual(normalized);
  });

  it("survives a round-trip with quotes and commas", () => {
    const rows = normalizeDataRows([
      ["name", "note"],
      ["Doe, John", 'said "hi"'],
    ]);
    const roundTripped = parseDataText(serializeDataRows(rows));
    expect(roundTripped).toEqual(rows);
  });
});
