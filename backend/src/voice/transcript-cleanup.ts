/**
 * whisper.cpp's CLI prints one timestamped line per segment on stdout by default
 * (`[00:00:00.000 --> 00:00:02.400]  Bonjour tout le monde`), and `nodejs-whisper`
 * hands that raw stdout back verbatim. Downstream (transcript-normalizer.ts,
 * voice-resolver.ts) expects a plain utterance, so this strips the timestamps and
 * joins the segments into one string.
 */
const TIMESTAMP_LINE = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*(.*)$/;

export function stripWhisperTimestamps(raw: string): string {
  return raw
    .split("\n")
    .map((line) => TIMESTAMP_LINE.exec(line.trim())?.[1]?.trim() ?? "")
    .filter((segment) => segment.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
