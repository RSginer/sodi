import { registerApiRoute } from "@mastra/core/server";
import View from "./View";
import { supabase } from "../mastra/supabase";

export const route = registerApiRoute("/verifactu", {
    method: "GET",
    handler: async (c) => {
      const id = c.req.query("id") as string;

      const { data: profile } = await supabase
        .from('profiles')
        .select('verifactu_link, name')
        .eq('id', id)
        .single();

      if (!profile) {
        return c.html(<h1>Usuario no encontrado</h1>);
      }

      return c.html(<View userName={profile?.name} verifactuLink={profile?.verifactu_link} />);
    },
  })