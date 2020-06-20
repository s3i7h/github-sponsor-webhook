import * as functions from 'firebase-functions'
import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook'
import { Webhooks } from '@octokit/webhooks'

const credit = {
  name: 'github-sponsor-webhook',
  author: 'Yu-ichiro',
  url: 'https://github.com/yu-ichiro/github-sponsor-webhook'
}

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
  icon_url: 'https://imgur.com/tF9e6pK.png'
}

function template<T extends string | number>(strings: TemplateStringsArray, ...keys: T[]) {
  return (function(...values: (string | Record<T, string>)[]) {
    const dict: Record<string | number, string> = {};
    let array: string[] = []
    for (const item of values)
      if (typeof item === "string")
        array.push(item)
      else
        Object.assign(dict, item)
    const result = [strings[0]];
    keys.forEach(function(key, i) {
      const index = Number(key)
      const value = Number.isNaN(index) || array.length <= index ? dict[key] : array[Number(key)];
      result.push(value, strings[i + 1]);
    });
    return result.join('');
  });
}

const plainMessages = {
  created: template`${'sponsor'} is a new sponsor of ${'sponsored'}!`,
  cancelled: template`${'sponsor'} is no longer a sponsor of ${'sponsored'}...`,
  upgraded: template`${'sponsor'} has upgraded sponsor tier of ${'sponsored'}!`,
  downgraded: template`${'sponsor'} has downgraded sponsor tier of ${'sponsored'}...`,
}

const mkdownMessages = {
  created: template`${'emoji'} *${'sponsor'}* is a new sponsor of *${'sponsored'}*!`,
  cancelled: template`${'emoji'} *${'sponsor'}* is no longer a sponsor of *${'sponsored'}*...`,
  upgraded: template`${'emoji'} *${'sponsor'}* has upgraded sponsor tier of *${'sponsored'}*!`,
  downgraded: template`${'emoji'} *${'sponsor'}* has downgraded sponsor tier of *${'sponsored'}*...`,
}

type Block = Exclude<IncomingWebhookSendArguments["blocks"], undefined>[number]
type SectionBlock = Extract<Block, { type: 'section' }>

const sponsorSection: (sponsorship: WebhookSponsorship["sponsorship"]) => SectionBlock = (sponsorship) => ({
  type: "section",
  text: {
    type: "mrkdwn",
    text: `*<${sponsorship.sponsor.html_url}|@${sponsorship.sponsor.login}>*` +
      `: *${sponsorship.tier.name}* ` +
      `sponsor of *<${sponsorship.sponsorable.html_url}|@${sponsorship.sponsorable.login}>*`
  },
  accessory: {
    type: "image",
    image_url: sponsorship.sponsor.avatar_url,
    alt_text: sponsorship.sponsor.login
  }
})

const struckSponsorSection: (sponsorship: WebhookSponsorship["sponsorship"]) => SectionBlock = (sponsorship) => {
  const regular = sponsorSection(sponsorship)
  if (regular.text)
    regular.text.text = `~${regular.text.text}~`
  return regular
}

const changedSponsorSection: (payload: WebhookPayloadSponsorshipTierChanged) => SectionBlock = (payload) => {
  const old = struckSponsorSection({ ...payload.sponsorship, tier: payload.changes.tier.from })
  const regular = sponsorSection(payload.sponsorship)
  if (regular.text && old.text)
    regular.text.text = old.text.text + `\n` + regular.text.text
  return regular
}

const handler = async (event: { payload: WebhookSponsorship }) => {
  const payload = event.payload
  const templateObj = {
    sponsor: payload.sponsorship.sponsor.login,
    sponsored: payload.sponsorship.sponsorable.login,
  }
  type Message = typeof mkdownMessages
  type MessageType = keyof Message
  type MessageArguments<T extends MessageType> = Parameters<Message[T]>[number]

  const sendArguments = <T extends MessageType>(mType: T, tempObj: MessageArguments<T>, ...blocks: Block[]) => ({
    text: plainMessages[mType](tempObj),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: mkdownMessages[mType](tempObj)
        }
      },
      {
        "type": "divider"
      },
      ...blocks,
      {
        type: "context",
        elements: [
          {
            type: 'mrkdwn',
            text: `<${credit.url}|${credit.name}>`
          }
        ]
      }
    ]
  })

  if (payload.action === "created") {
    await slack.send({
      ...defaultSendArguments,
      ...sendArguments(
        'created',
        { ...templateObj, emoji:':tada:' },
        sponsorSection(payload.sponsorship)
      )
    })
  }
  if (payload.action === "cancelled") {
    await slack.send({
      ...defaultSendArguments,
      ...sendArguments(
        'cancelled',
        { ...templateObj, emoji:':cry:' },
        struckSponsorSection(payload.sponsorship)
      )
    })
  }
  if (payload.action === "tier_changed") {
    if (payload.changes.tier.from.monthly_price_in_dollars < payload.sponsorship.tier.monthly_price_in_dollars)
      await slack.send({
        ...defaultSendArguments,
        ...sendArguments(
          'upgraded',
          { ...templateObj, emoji:':tada:' },
          changedSponsorSection(payload)
        )
      })
    else
      await slack.send({
        ...defaultSendArguments,
        ...sendArguments(
          'downgraded',
          { ...templateObj, emoji:':cry:' },
          changedSponsorSection(payload as WebhookPayloadSponsorshipTierChanged)
        )
      })
  }

}

githubWebhook.on("sponsorship", handler as any)

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
export const github = functions.https.onRequest(async (request, response) => {
  if (request.headers['x-github-event'] != null)
    return githubWebhook.middleware(request, response)
  response.sendStatus(400)
});
