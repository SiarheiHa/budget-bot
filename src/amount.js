export const MAX_INTEGER_DIGITS = 10;
export const MAX_DECIMAL_DIGITS = 2;

function toDraft(draft) {
  return typeof draft === "string" ? draft : "";
}

function splitDraft(draft) {
  const value = toDraft(draft);
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const separatorIndex = body.indexOf(",");

  if (separatorIndex === -1) {
    return { negative, integer: body, fraction: null };
  }

  return {
    negative,
    integer: body.slice(0, separatorIndex),
    fraction: body.slice(separatorIndex + 1),
  };
}

function joinDraft({ negative, integer, fraction }) {
  const sign = negative ? "-" : "";
  const decimal = fraction === null ? "" : `,${fraction}`;
  return `${sign}${integer}${decimal}`;
}

function trimLeadingZeros(value) {
  return value.replace(/^0+(?=\d)/, "");
}

export function appendDigit(draft, digit) {
  const value = String(digit);
  if (!/^\d$/.test(value)) return toDraft(draft);

  const parts = splitDraft(draft);

  if (parts.fraction !== null) {
    if (parts.fraction.length >= MAX_DECIMAL_DIGITS) return toDraft(draft);
    return joinDraft({
      ...parts,
      fraction: parts.fraction + value,
    });
  }

  if (parts.integer.length >= MAX_INTEGER_DIGITS) return toDraft(draft);

  return joinDraft({
    ...parts,
    integer: trimLeadingZeros(parts.integer + value),
  });
}

export function appendDoubleZero(draft) {
  return appendDigit(appendDigit(draft, "0"), "0");
}

export function appendSeparator(draft) {
  const parts = splitDraft(draft);
  if (parts.fraction !== null) return toDraft(draft);

  return joinDraft({
    ...parts,
    integer: parts.integer || "0",
    fraction: "",
  });
}

export function backspace(draft) {
  return toDraft(draft).slice(0, -1);
}

export function clearDraft() {
  return "";
}

export function toggleSign(draft) {
  const value = toDraft(draft);
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

export function applyAmountAction(draft, action) {
  switch (action?.type) {
    case "digit":
      return appendDigit(draft, action.value);
    case "doubleZero":
      return appendDoubleZero(draft);
    case "separator":
      return appendSeparator(draft);
    case "backspace":
      return backspace(draft);
    case "clear":
      return clearDraft();
    case "sign":
      return toggleSign(draft);
    default:
      return toDraft(draft);
  }
}

export function parseAmountCallback(data) {
  if (typeof data !== "string") return null;

  if (data === "v1:amt:00") return { type: "doubleZero" };
  if (data === "v1:amt:sep") return { type: "separator" };
  if (data === "v1:amt:back") return { type: "backspace" };
  if (data === "v1:amt:clear") return { type: "clear" };
  if (data === "v1:amt:sign") return { type: "sign" };
  if (data === "v1:amt:ok") return { type: "confirm" };

  const digitMatch = /^v1:amt:d:(\d)$/.exec(data);
  if (digitMatch) return { type: "digit", value: digitMatch[1] };

  return null;
}

export function formatAmountDraft(draft) {
  const value = toDraft(draft);
  if (value === "") return "0";
  if (value === "-") return "-";

  const parts = splitDraft(value);
  const integer = parts.integer === "" ? "0" : parts.integer;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sign = parts.negative ? "-" : "";
  const decimal = parts.fraction === null ? "" : `,${parts.fraction}`;

  return `${sign}${grouped}${decimal}`;
}

export function formatAmountValue(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "";

  const value = String(amount);
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [integer, fraction] = body.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  return `${negative ? "-" : ""}${grouped}${fraction ? `,${fraction}` : ""}`;
}
