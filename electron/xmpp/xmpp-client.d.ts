declare module '@xmpp/client' {
  export function xml(
    name: string,
    ...children: Array<Record<string, string | undefined> | object | string | undefined>
  ): object;

  export function client(options: Record<string, unknown>): object;
}
