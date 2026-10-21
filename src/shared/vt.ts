/**
 * Drop what a serialized screen ends with but nobody wants to see again: the empty rows below
 * the prompt and the cursor moves back up to it. Keeps every printed character.
 */
export function trimTrailingBlank(log: string): string {
  return log.replace(/(?:\s|\x1b\[[0-9;]*[ABCDEFGHJKf]|\x1b\[0?m)+$/, '')
}
