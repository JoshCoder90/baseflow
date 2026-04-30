/**
 * Gmail send + DB updates for an already-claimed campaign_messages row (status = sending).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { isValidEmail } from "@/lib/email-send-filter"
import type { ClaimedCampaignMessageRow } from "@/lib/get-next-campaign-message"
import { revertCampaignMessageToQueued } from "@/lib/get-next-campaign-message"
import { bumpConversationLastMessage } from "@/lib/bump-conversation-last-message"
import {
  countMailboxSendsRolling24h,
  getEffectiveMailboxRollingSendCap,
  getMailboxEmailForUser,
} from "@/lib/mailbox-daily-send-cap"
import { sendOutboundEmailViaGmailServiceRole } from "@/lib/send-email-via-gmail"
import { persistCampaignMessageSentRow } from "@/lib/persist-campaign-message-sent"

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

  const cap = getEffectiveMailboxRollingSendCap()
  const senderMailbox = await getMailboxEmailForUser(supabase, ownerUserId)
  if (cap !== null && senderMailbox) {
    const sentLast24h = await countMailboxSendsRolling24h(supabase, ownerUserId)
    if (sentLast24h >= cap) {
      console.log("Mailbox rolling cap hit (env MAILBOX_ROLLING_SEND_CAP / DISABLE):", senderMailbox)
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

    const sendResult = await sendOutboundEmailViaGmailServiceRole(supabase, {
      ownerUserId,
      toEmail: lead.email,
      subject: subject || "No subject",
      html,
    })

    if (!sendResult.ok && sendResult.status === 400) {
      const err = sendResult.error
      if (err === "GMAIL_RECONNECT_REQUIRED") {
        await supabase
          .from("campaign_messages")
          .update({
            status: "failed",
            error_message: "GMAIL_RECONNECT_REQUIRED",
          })
          .eq("id", claimed.id)
      } else if (err === "Invalid domain" || err === "Filtered invalid email") {
        const filtered = err === "Filtered invalid email"
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
    } else if (sendResult.ok) {
      const threadId = sendResult.threadId
      const gmailMessageId = sendResult.gmailMessageId

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
        gmail_message_id: gmailMessageId ?? null,
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

      let rowMarkedSent = await persistCampaignMessageSentRow(supabase, {
        messageId: claimed.id,
        sentAt,
        senderMailbox: resolvedSender,
      })

      if (!rowMarkedSent) {
        const lastChance = await supabase
          .from("campaign_messages")
          .update({
            status: "sent",
            sent_at: sentAt,
            next_send_at: null,
          })
          .eq("id", claimed.id)
          .eq("status", "sending")
        if (!lastChance.error) {
          rowMarkedSent = true
        } else {
          console.error(
            "[execute-campaign-message-send] Email delivered but DB did not record sent — queue may stay blocked until stale release:",
            lastChance.error
          )
        }
      }

      let sentUpdateErr: Error | null = null
      if (rowMarkedSent) {
        const { error } = await supabase
          .from("leads")
          .update({
            status: "sent",
            next_send_at: null,
          })
          .eq("id", lead.id)
        sentUpdateErr = error
      }

      if (rowMarkedSent && !sentUpdateErr) {
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
      } else if (sentUpdateErr) {
        console.error("Failed to mark lead sent:", sentUpdateErr)
      }
    } else {
      console.warn("[execute-campaign-message-send] Gmail send failed — reverting to queued", {
        campaignId,
        campaignMessageId: claimed.id,
        leadId: lead.id,
        status: sendResult.ok ? undefined : sendResult.status,
        error: sendResult.ok ? undefined : sendResult.error,
      })
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
