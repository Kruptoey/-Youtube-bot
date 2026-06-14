import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log("Checking channel_settings...");
  const { data, error } = await supabase.from("channel_settings").select("*");
  console.log("SELECT Data:", data);
  console.log("SELECT Error:", error);

  if (data && data.length === 0) {
    console.log("Attempting test insert...");
    const { error: insertError } = await supabase.from("channel_settings").insert([{
      channel_id: "test",
      channel_name: "Test Channel",
      access_token: "test_token"
    }]);
    console.log("INSERT Error:", insertError);
  }
}

check();
