export function createOpaqueId(prefix: string): string { return `${prefix}_${crypto.randomUUID()}`; }
