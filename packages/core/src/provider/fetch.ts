export type LareCodeFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
