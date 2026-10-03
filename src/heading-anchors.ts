/** Assign stable, unique anchors from rendered heading text. */
export function getHeadingAnchor(
  text: string,
  counts: Map<string, number>,
  used: Set<string>
): string {
  const slug =
    text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "")
      .trim()
      .replace(/ +/g, "-") || "section";
  let count = counts.get(slug) || 0;
  let anchor = count ? `${slug}-${count}` : slug;
  while (used.has(anchor)) {
    count++;
    anchor = `${slug}-${count}`;
  }
  counts.set(slug, count + 1);
  used.add(anchor);
  return anchor;
}
