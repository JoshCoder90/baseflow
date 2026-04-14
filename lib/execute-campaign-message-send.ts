/**
 * Gmail send + DB updates for an already-claimed campaign_messages row (status = sending).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { isValidEmail } from "@/lib/email-send-filter"
import type { ClaimedCampaignMessageRow } from "@/lib/get-next-campaign-message"
import { revertCampaignMessageToQueued } from "@/lib/get-next-campaign-message"
import { bumpConversationLastMessage } from "@/lib/bump-conversation-last-message"
import {
  DAILY_MAILBOX_SEND_CAP,
  countMailboxSendsRolling24h,
  getMailboxEmailForUser,
} from "@/lib/mailbox-daily-send-cap"

export type ExecuteCampaignMessageSendResult = {
  processed: number
  campaignStatus: string | null
  rejected?: boolean
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function appOriginForInternalFetch(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000"
  return base
}

export async function executeClaimedCampaignMessageSend(
  supabase: SupabaseClient,
  params: {
    campaignId: string
    ownerUserId: string
    subject: string | null
    claimed: ClaimedCampaignMessageRow
  }
): Promise<ExecuteCampaignMessageSendResult> {
  const { campaignId, ownerUserId, subject, claimed } = params

  const senderMailbox = await getMailboxEmailForUser(supabase, ownerUserId)
  if (senderMailbox) {
    const sentLast24h = await countMailboxSendsRolling24h(supabase, senderMailbox)
    if (sentLast24h >= DAILY_MAILBOX_SEND_CAP) {
      console.log("Daily cap hit for mailbox:", senderMailbox)
      await revertCampaignMessageToQueued(
        supabase,
        claimed.id,
        claimed.next_send_at
      )
      const { data: statusRow } = await supabase
        .from("campaigns")
        .select("status")
        .eq("id", campaignId)
        .single()
      return {
        processed: 0,
        campaignStatus: statusRow?.status ?? null,
      }
    }
  }

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, email, name, company, status")
    .eq("id", claimed.lead_id)
    .single()

  if (leadErr || !lead?.email) {
    await supabase
      .from("campaign_messages")
      .update({
        status: "failed",
        error_message: "Lead has no email",
      })
      .eq("id", claimed.id)
    const { data: statusRow } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .single()
    return {
      processed: 1,
      campaignStatus: statusRow?.status ?? null,
    }
  }

  try {
    const emailCheck = await isValidEmail(lead.email)
    if (!emailCheck.ok) {
      const errMsg =
        emailCheck.reason === "dns" ? "Invalid domain" : "Filtered invalid email"
      await supabase
        .from("campaign_messages")
        .update({ status: "failed", error_message: errMsg })
        .eq("id", claimed.id)
      await supabase
        .from("leads")
        .update({ status: "invalid_email", next_send_at: null })
        .eq("id", lead.id)

      const { data: statusRow } = await supabase
        .from("campaigns")
        .select("status")
        .eq("id", campaignId)
        .single()

      return {
        processed: 1,
        campaignStatus: statusRow?.status ?? null,
        rejected: true,
      }
    }

    const raw = (claimed.message_body ?? "").trim()
    const html =
      raw === ""
        ? "<p></p>"
        : raw.includes("<")
          ? raw
          : `<p>${raw.replace(/\n/g, "<br />")}</p>`

    const sendUrl = `${appOriginForInternalFetch()}/api/send-email`
    const res = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: lead.email,
        subject: subject || "No subject",
        html,
        userId: ownerUserId,
      }),
    })

    if (res.status === 400) {
      let body: { error?: string } = {}
      try {
        body = (await res.json()) as { error?: string }
      } catch {
        /* ignore */
      }
      if (body.error === "GMAIL_RECONNECT_REQUIRED") {
        await supabase
          .from("campaign_messages")
          .update({
            status: "failed",
            error_message: "GMAIL_RECONNECT_REQUIRED",
          })
          .eq("id", claimed.id)
      } else if (body.error === "Invalid domain" || body.error === "Filtered invalid email") {
        const filtered = body.error === "Filtered invalid email"
        await supabase
          .from("campaign_messages")
          .update({
            status: "failed",
            error_message: filtered ? "Filtered invalid email" : "Invalid domain",
          })
          .eq("id", claimed.id)
        await supabase
          .from("leads")
          .update({ status: "invalid_email", next_send_at: null })
          .eq("id", lead.id)
      } else {
        await revertCampaignMessageToQueued(
          supabase,
          claimed.id,
          claimed.next_send_at
        )
      }
    } else if (res.status === 200) {
      let threadId: string | undefined
      try {
        const sendBody = (await res.json()) as { threadId?: string }
        threadId = sendBody.threadId
      } catch {
        /* ignore */
      }

      const sentAt = new Date().toISOString()
      const conversationContent =
        raw.length > 0 ? raw : htmlToPlainText(html) || "(email)"

      console.log("Saving sent message to DB")
      const { error: convErr } = await supabase.from("messages").insert({
        lead_id: lead.id,
        campaign_id: campaignId,
        role: "outbound",
        content: conversationContent,
        created_at: sentAt,
        thread_id: threadId ?? null,
      })
      if (convErr) {
        console.error("[execute-campaign-message-send] messages insert:", convErr)
      } else if (threadId) {
        await bumpConversationLastMessage(supabase, {
          userId: ownerUserId,
          threadId,
          messageAt: sentAt,
          lastMessageRole: "outbound",
        })
      }

      const resolvedSender =
        senderMailbox ?? (await getMailboxEmailForUser(supabase, ownerUserId))

      const { error: msgErr } = await supabase
        .from("campaign_messages")
        .update({
          status: "sent",
          sent_at: sentAt,
          next_send_at: null,
          ...(resolvedSender ? { sender_email: resolvedSender } : {}),
        })
        .eq("id", claimed.id)
        .eq("status", "sending")

      if (msgErr) {
        console.error("Failed to mark campaign_message sent:", msgErr)
      }

      const { error: sentUpdateErr } = await supabase
        .from("leads")
        .update({
          status: "sent",
          next_send_at: null,
        })
        .eq("id", lead.id)

      if (!sentUpdateErr) {
        const { count: unsentMsgs } = await supabase
          .from("campaign_messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .is("sent_at", null)

        if ((unsentMsgs ?? 0) === 0) {
          await supabase
            .from("campaigns")
            .update({ status: "completed" })
            .eq("id", campaignId)
          console.log(`Campaign completed: ${campaignId}`)
        }
      } else {
        console.error("Failed to mark lead sent:", sentUpdateErr)
      }
    } else {
      await revertCampaignMessageToQueued(
        supabase,
        claimed.id,
        claimed.next_send_at
      )
    }
  } catch (err) {
    console.error("EMAIL ERROR:", err)
    await revertCampaignMessageToQueued(
      supabase,
      claimed.id,
      claimed.next_send_at
    )
  }

  const { data: statusRow } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .single()

  return {
    processed: 1,
    campaignStatus: statusRow?.status ?? null,
  }
}
