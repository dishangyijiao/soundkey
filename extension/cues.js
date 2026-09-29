(() => {
  function cleanCue(value) {
    return String(value ?? "")
      .replace(/\[\s*(?:music|applause|laughter|inaudible|音樂|音乐)[^\]]*\]/gi, " ")
      .replace(/>>+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Input is the parallel score sequences returned by the API. Missing phones
  // are represented as empty cells, so both rows always share column indexes.
  function scoreColumns(score) {
    if (Array.isArray(score?.columns)) return score.columns;
    const expected = score?.expected || [];
    const heard = score?.heard || [];
    const out = [];
    for (let i = 0; i < Math.max(expected.length, heard.length); i++) {
      out.push({ expected: expected[i] || null, heard: heard[i] || null,
        status: expected[i] && heard[i] ? (expected[i].phone === heard[i].phone ? "match" : "sub") : expected[i] ? "del" : "ins" });
    }
    return out;
  }

  function selectedWord(text, start, end) {
    const value = String(text ?? "");
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > value.length) return null;
    const raw = value.slice(start, end).trim();
    const match = raw.match(/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/);
    return match ? match[0].replace(/[’]/g, "'") : null;
  }

  const api = { cleanCue, scoreColumns, selectedWord };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.FengsongCues = api;
})();
