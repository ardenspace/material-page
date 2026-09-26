import { createClient } from "npm:@supabase/supabase-js@2";
import { handleIngest } from "./handler.ts";

Deno.serve((request) => handleIngest(request, Deno.env.get("INGEST_SECRET") ?? "", async (messageId, receivedAt, cards, skipped) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service configuration missing");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("ingest_batch", {
    p_message_id: messageId, p_received_at: receivedAt, p_items: cards, p_skipped: skipped,
  });
  if (error) throw error;
  return data;
}));
