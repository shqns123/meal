export function selectedMutationMonth(message, fallbackMonth) {
  const text = String(message || "");
  const full = text.match(/(20\d{2})\s*[년./-]\s*(1[0-2]|0?[1-9])\s*월?/);
  if (full) return `${full[1]}-${String(Number(full[2])).padStart(2, "0")}`;
  const monthOnly = text.match(/(?:^|\s)(1[0-2]|0?[1-9])\s*월/);
  if (monthOnly && /^\d{4}-\d{2}$/.test(fallbackMonth || ""))
    return `${fallbackMonth.slice(0, 4)}-${String(Number(monthOnly[1])).padStart(2, "0")}`;
  if (/^\d{4}-\d{2}$/.test(fallbackMonth || "")) {
    const [year, month] = fallbackMonth.split("-").map(Number);
    const amount = /다다음\s*달/.test(text)
      ? 2
      : /다음\s*달/.test(text)
        ? 1
        : /(?:지난|저번)\s*달/.test(text)
          ? -1
          : 0;
    if (amount) {
      const value = new Date(Date.UTC(year, month - 1 + amount, 1));
      return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
    }
  }
  return fallbackMonth;
}
