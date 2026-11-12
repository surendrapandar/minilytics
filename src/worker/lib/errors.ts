/** A problem with the request, shown to whoever made it (the dashboard or an MCP agent). */
export class UserError extends Error {
  constructor(
    public status: 400 | 401 | 402 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
