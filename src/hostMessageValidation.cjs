function isWebviewMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value;
  if (typeof message.type !== "string") return false;
  const text = (input, limit) => typeof input === "string" && input.length <= limit;
  const exact = (...keys) => Object.keys(message).every((key) => ["type", ...keys].includes(key));
  if (["ready", "openFile"].includes(message.type)) return exact();
  if (message.type === "documentChanged") {
    return exact("html", "reason") && text(message.html, 20_000_000) &&
      (message.reason === undefined || text(message.reason, 200));
  }
  if (["save", "copy", "download"].includes(message.type)) return exact("html") && text(message.html, 20_000_000);
  if (message.type === "documentEdit") {
    return exact("from", "to", "text", "expected", "fallbackHtml", "reason") &&
      Number.isInteger(message.from) && Number.isInteger(message.to) && message.from >= 0 && message.to >= message.from &&
      text(message.text, 5_000_000) && text(message.expected, 5_000_000) && text(message.fallbackHtml, 20_000_000) &&
      (message.reason === undefined || text(message.reason, 200));
  }
  if (message.type === "bridgeStatus") {
    const list = (input) => input === undefined || (Array.isArray(input) && input.length <= 200 && input.every((item) => text(item, 500)));
    return exact("state", "codes", "resourceFailures") && ["loading", "ready", "degraded", "failed"].includes(String(message.state)) &&
      list(message.codes) && list(message.resourceFailures);
  }
  if (message.type === "copyText") return exact("text") && text(message.text, 1_000_000);
  if (message.type === "downloadBinary") {
    return exact("fileName", "contentType", "base64") && text(message.fileName, 500) && !/[\\/]/.test(message.fileName) &&
      message.fileName.toLowerCase().endsWith(".pptx") &&
      message.contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" &&
      text(message.base64, 30_000_000) && /^[A-Za-z0-9+/]*={0,2}$/.test(message.base64);
  }
  return false;
}

module.exports = { isWebviewMessage };
