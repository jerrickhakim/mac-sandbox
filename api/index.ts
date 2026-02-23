import { handle } from "hono/vercel";
import { createServer } from "../dist/server/index.js";

export const config = {
  runtime: "nodejs",
};

const app = createServer();

export default handle(app);
