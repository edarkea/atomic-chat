/** Returns the bare, case-insensitive JID with the historical no-trim semantics. */
export function bareJid(value: string): string {
  return value.split('/')[0].toLowerCase();
}

/** Returns a bare JID after trimming the bare-part whitespace accepted by identity stores. */
export function normalizedBareJid(value: string): string {
  return value.split('/')[0].trim().toLowerCase();
}

/** Normalizes an account identifier at storage and identity boundaries. */
export function normalizedAccountId(value: string): string {
  return value.trim().toLowerCase();
}
