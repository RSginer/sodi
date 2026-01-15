import { registerApiRoute } from "@mastra/core/server";
import View from "./View";

export const route = registerApiRoute("/view", {
    method: "GET",
    handler: async (c) => {
      return c.html(<View messages={[]} />);
    },
  })