/** Delimit literal generated code without changing the original payload. */
function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    current = character === "`" ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function isMultilineCode(value: string): boolean {
  return /[\r\n]/.test(value);
}

/** Callers use fenced blocks for multiline commands; spans normalize newlines. */
export function markdownCodeSpan(value: string): string {
  const delimiter = "`".repeat(longestBacktickRun(value) + 1);
  const padding =
    value.startsWith("`") ||
    value.endsWith("`") ||
    (value.startsWith(" ") && value.endsWith(" ") && /[^ ]/.test(value))
      ? " "
      : "";
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
}

export function markdownCodeBlock(value: string, language = ""): string {
  const delimiter = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${delimiter}${language}\n${value}\n${delimiter}`;
}

/** Keep command labels on one heading line without interpreting literal ticks. */
export function markdownCommandName(value: string): string {
  if (isMultilineCode(value)) return markdownCodeSpan(JSON.stringify(value));
  return value.includes("`") ? markdownCodeSpan(value) : value;
}
