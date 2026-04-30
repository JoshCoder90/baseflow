import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { InboxClient } from "./InboxClient"
import { fetchInboxLeadsForUser } from "./inbox-data"

export default async function InboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const leadsWithMeta = await fetchInboxLeadsForUser(supabase, user.id)

  return <InboxClient leads={leadsWithMeta} />
}
