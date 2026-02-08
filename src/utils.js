function normalizeText(t) {
  return (t || "").trim().toLowerCase();
}

function isDigits(str) {
  return /^[0-9]+$/.test(str || "");
}

module.exports = { normalizeText, isDigits };
