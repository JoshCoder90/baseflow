import { supabase } from "@/lib/supabase"

export async function getTestData() {
  const { data, error } = await supabase
    .from("test")
    .select("*")

  if (error) {
    throw new Error(error.message)
  }

  return data
}
