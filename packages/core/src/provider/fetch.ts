export type LumpsCodeFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
