import * as functions from 'firebase-functions'
import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook'
import { Webhooks } from '@octokit/webhooks'


interface Config {
  readonly env: {
    readonly slack: string  // Webhook URL
    readonly secret: string  // Github Event Secret
  }
}

const config: Config = functions.config() as any
const githubWebhook = new Webhooks({
  secret: config.env.secret
})

const slack = new IncomingWebhook(config.env.slack)

interface WebhookPayloadSponsorshipCreated extends Webhooks.WebhookPayloadSponsorship {
  action: "created"
  changes: undefined
  effective_date: undefined
}

interface WebhookPayloadSponsorshipCancelled extends Webhooks.WebhookPayloadSponsorship {
  action: "cancelled"
  changes: undefined
  effective_date: undefined
}

interface WebhookPayloadSponsorshipEdited extends Webhooks.WebhookPayloadSponsorship {
  action: "edited"
  changes: {
    tier: any  // it's actually undefined
    privacy_level: {
      from: string
    }
  }
  effective_date: undefined
}

interface WebhookPayloadSponsorshipTierChanged extends Webhooks.WebhookPayloadSponsorship {
  action: "tier_changed"
  changes: Webhooks.WebhookPayloadSponsorshipChanges
  effective_date: undefined
}

interface WebhookPayloadSponsorshipPendingTierChange extends Webhooks.WebhookPayloadSponsorship {
  action: "pending_tier_change"
  changes: Webhooks.WebhookPayloadSponsorshipChanges
  effective_date: string
}

interface WebhookPayloadSponsorshipPendingCancellation extends Webhooks.WebhookPayloadSponsorship {
  action: "pending_cancellation"
  changes: undefined
  effective_date: string
}

type WebhookSponsorship = (
  | WebhookPayloadSponsorshipCreated
  | WebhookPayloadSponsorshipCancelled
  | WebhookPayloadSponsorshipEdited
  | WebhookPayloadSponsorshipTierChanged
  | WebhookPayloadSponsorshipPendingTierChange
  | WebhookPayloadSponsorshipPendingCancellation
)

const defaultSendArguments: IncomingWebhookSendArguments = {
  username: 'GitHub Sponsor',
  icon_url: 'https://github.githubassets.com/images/modules/site/sponsors/logo-mona.svg'
}

type Block = Exclude<IncomingWebhookSendArguments["blocks"], undefined>[number]

const newSponsorSection: (payload: WebhookPayloadSponsorshipCreated) => Block = (payload) => ({
  type: "section",
  text: {
    type: "mrkdwn",
    text: `*${payload.sponsorship.sponsor.login}*` +
      ` (<${payload.sponsorship.sponsor.url}|${payload.sponsorship.sponsor.id}>)` +
      `: *${payload.sponsorship.tier.name}* (\$${payload.sponsorship.tier.monthly_price_in_dollars}.00/month)` +
      `sponsor of *<${payload.sponsorship.sponsorable.url}|${payload.sponsorship.sponsorable.id}>*`
  },
  accessory: {
    type: "image",
    image_url: payload.sponsorship.sponsor.avatar_url
  }
})

const cancelledSponsorSection: (payload: WebhookPayloadSponsorshipCancelled) => Block = (payload) => ({
  type: "section",
  text: {
    type: "mrkdwn",
    text: `~ *${payload.sponsorship.sponsor.login}*` +
      ` (<${payload.sponsorship.sponsor.url}|${payload.sponsorship.sponsor.id}>)` +
      `: *${payload.sponsorship.tier.name}* (\$${payload.sponsorship.tier.monthly_price_in_dollars}.00/month)` +
      `sponsor of *<${payload.sponsorship.sponsorable.url}|${payload.sponsorship.sponsorable.id}>* ~`
  },
  accessory: {
    type: "image",
    image_url: payload.sponsorship.sponsor.avatar_url
  }
})

githubWebhook.on("sponsorship", async (event) => {
  const payload = event.payload as WebhookSponsorship

  if (payload.action === "created") {
    await slack.send({
      ...defaultSendArguments,
      text: `${payload.sponsorship.sponsor.login} is a new sponsor of ${payload.sponsorship.sponsorable.login}!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:tada: *${payload.sponsorship.sponsor.login}* is a new sponsor of *${payload.sponsorship.sponsorable.login}*!`
          }
        },
        newSponsorSection(payload)
      ]
    })
  }
  if (payload.action === "cancelled") {
    await slack.send({
      ...defaultSendArguments,
      text: `${payload.sponsorship.sponsor.login} is no longer a sponsor of ${payload.sponsorship.sponsorable.login}...`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:cry: *${payload.sponsorship.sponsor.login}* is no longer a sponsor of *${payload.sponsorship.sponsorable.login}*...`
          }
        },
        cancelledSponsorSection(payload)
      ]
    })
  }

})

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
export const github = functions.https.onRequest(async (request, response) => {
  if (request.headers['x-github-event'] != null)
    return githubWebhook.middleware(request, response)
  response.sendStatus(400)
});
