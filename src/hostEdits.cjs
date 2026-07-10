function planHostEdit(current, edit) {
  if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 || edit.to < edit.from) {
    return { mode: "fallback", html: edit.fallbackHtml, reason: "invalid-range" };
  }
  if (edit.to > current.length || current.slice(edit.from, edit.to) !== edit.expected) {
    return { mode: "fallback", html: edit.fallbackHtml, reason: "source-mismatch" };
  }
  return { mode: "targeted", from: edit.from, to: edit.to, text: edit.text };
}

module.exports = { planHostEdit };
