import { handle, type D1Like } from "./handler";

export default {
  async fetch(request: Request, env: { DB: D1Like }): Promise<Response> {
    return handle(request, env.DB);
  },
};
