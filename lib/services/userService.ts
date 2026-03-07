import { supabase } from "@/lib/supabase"

export async function createUser(email: string, niche: string) {
  const { data, error } = await supabase
    .from("users")
    .insert([{ email, niche }])
    .select()

  if (error) throw new Error(error.message)

  return data
}

export async function getUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("*")

  if (error) throw new Error(error.message)

  return data
}
