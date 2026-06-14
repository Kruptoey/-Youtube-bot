"use server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { revalidatePath } from "next/cache";

export async function createPersonaAction(newPersona: any) {
  try {
    const { error } = await supabaseAdmin.from("ai_personas").insert([newPersona]);
    if (error) {
      console.error("Supabase error in createPersonaAction:", error);
      return { error: error.message };
    }
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/agents");
    return { success: true };
  } catch (err: any) {
    console.error("Unhandled exception in createPersonaAction:", err);
    return { error: err.message || "Unknown error" };
  }
}

export async function updatePersonaAction(id: string, updatedPersona: any) {
  try {
    const { error } = await supabaseAdmin.from("ai_personas").update(updatedPersona).eq("id", id);
    if (error) {
      console.error("Supabase error in updatePersonaAction:", error);
      return { error: error.message };
    }
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/agents");
    return { success: true };
  } catch (err: any) {
    console.error("Unhandled exception in updatePersonaAction:", err);
    return { error: err.message || "Unknown error" };
  }
}

export async function deletePersonaAction(id: string) {
  try {
    const { error } = await supabaseAdmin.from("ai_personas").delete().eq("id", id);
    if (error) {
      console.error("Supabase error in deletePersonaAction:", error);
      return { error: error.message };
    }
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/agents");
    return { success: true };
  } catch (err: any) {
    console.error("Unhandled exception in deletePersonaAction:", err);
    return { error: err.message || "Unknown error" };
  }
}

export async function fetchPersonasAction() {
  const { data, error } = await supabaseAdmin.from("ai_personas").select("*").order("created_at", { ascending: true });
  if (error) {
    return { error: error.message, data: null };
  }
  return { success: true, data };
}

export async function fetchAssetsAction() {
  const { data, error } = await supabaseAdmin.from("assets").select("*").order("created_at", { ascending: false });
  if (error) {
    return { error: error.message, data: null };
  }
  return { success: true, data };
}

export async function uploadAssetAction(formData: FormData, folder: string = "kruptoey") {
  try {
    const file = formData.get("file") as File;
    if (!file) return { error: "No file provided" };

    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;

    // Convert file to array buffer to upload from server
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabaseAdmin.storage.from("assets").upload(filePath, buffer, {
      contentType: file.type,
    });

    if (uploadError) return { error: "Storage upload failed: " + uploadError.message };

    const { data: publicUrlData } = supabaseAdmin.storage.from("assets").getPublicUrl(filePath);
    
    const { error: dbError } = await supabaseAdmin.from("assets").insert([{ 
      filename: file.name, 
      storage_path: filePath, 
      public_url: publicUrlData.publicUrl 
    }]);

    if (dbError) return { error: "DB insert failed: " + dbError.message };

    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Unknown error" };
  }
}

export async function deleteAssetAction(id: string, storagePath: string) {
  try {
    await supabaseAdmin.storage.from("assets").remove([storagePath]);
    await supabaseAdmin.from("assets").delete().eq("id", id);
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Unknown error" };
  }
}

// Ultra-lean approach to store settings without DB schema changes
export async function saveBrandDNAAction(dnaText: string) {
  try {
    const filePath = "settings/brand_dna.json";
    const content = JSON.stringify({ brand_dna: dnaText });
    
    // Attempt to update, if fails, upload (upsert)
    const { error } = await supabaseAdmin.storage.from("assets").upload(filePath, content, {
      contentType: "application/json",
      upsert: true
    });
    
    if (error) return { error: "Failed to save Brand DNA: " + error.message };
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Unknown error" };
  }
}

export async function fetchBrandDNAAction() {
  try {
    const { data, error } = await supabaseAdmin.storage.from("assets").download("settings/brand_dna.json");
    if (error) {
      if (error.message.includes("Object not found")) return { success: true, data: "" };
      return { error: error.message, data: "" };
    }
    const text = await data.text();
    const json = JSON.parse(text);
    return { success: true, data: json.brand_dna || "" };
  } catch (err: any) {
    return { error: err.message || "Unknown error", data: "" };
  }
}
