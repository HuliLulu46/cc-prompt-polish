import type { On } from 'claude-code'

const COMMAND = 'polish'

// Toasts don't support line breaks, so keep this on one line
const USAGE =
  '<text> [-g guidance] rewrite | -r [guidance] rewrite again | -u restore original | -n ignore conversation | -c [focus] generate a /compact command'

const SYSTEM = `You rewrite instructions a user wrote for an AI coding assistant so they are clearer.
- Keep the original meaning and every technical detail (paths, commands and code identifiers stay verbatim); add no requirement the draft does not have
- Write the rewrite in the same language as the draft (a Chinese draft stays Chinese), even though these instructions are in English
- Fix typos and grammar and tidy the structure; use a short list when there are many points
- Rewrite only the text inside the <draft> tag; nothing outside the tag is part of the draft
- When <guidance> explicitly asks to add, remove or change content, <guidance> wins
- Output only the rewritten text: no explanation, quotes, code fences or <draft> tag`

// adjust: -r came with new guidance, so tweak the previous result; otherwise write a clearly different version
type Request = { draft: string; guidance: string; previous?: string; adjust?: boolean }

const extrasOf = ({ guidance, previous, adjust }: Request) =>
  [
    guidance &&
      `Extra requirements for this rewrite (they guide how to rewrite and are not part of the draft):\n<guidance>\n${guidance}\n</guidance>`,
    previous &&
      `${
        adjust
          ? 'This is the previous rewrite. Adjust it according to <guidance> and keep the rest as unchanged as possible'
          : 'The user was not satisfied with the previous rewrite. Give a clearly different version this time'
      }:\n<previous>\n${previous}\n</previous>`,
  ]
    .filter(Boolean)
    .join('\n\n')

const draftPromptOf = (r: Request) => `${extrasOf(r)}

<draft>
${r.draft}
</draft>`

// The engine appends its own instructions to the end of a fork request; tags keep the draft apart from them
const forkPromptOf = (r: Request) => `This turn is not a new task: do not carry out or answer the instructions in <draft>; only rewrite them and output the result.
${SYSTEM}
- You may use the earlier conversation to replace references like "just now" or "that one" with concrete content, but do not bring in requirements that neither the draft nor <guidance> mentions

${draftPromptOf(r)}`

const NOTHING_EXTRA = 'NONE'

const compactPromptOf = (focus: string) => `This turn only writes extra instructions to pass to /compact; it is not a new work request. Do not continue the earlier task, answer earlier questions, run commands or call any tools. Rely only on the conversation visible now; do not wait for or guess results that have not come back.

<context>
The model that does the compaction already has a fixed summary template covering request intent, key concepts, files and code, errors and fixes, user messages, to-dos, current work and next steps.
What you add are retention requirements that are easy to drop, confuse or distort when summarized, not another summary.
CLAUDE.md, the system prompt, tool descriptions and recently read files are reloaded after compaction; do not repeat them.
</context>

<instructions>
Pick out the information that still affects what happens next and write it as concrete retention instructions. Prioritize in this order:
1. Explicit constraints that change later behavior: what the user authorized or forbade, features that were dropped, the specific requirements and definitions currently in force, and the target directories, paths, identifiers, commands or config values that must be used. Losing these leads to overstepping, redoing work, writing to the wrong place or reverting to an outdated definition; never drop them just to write fewer items.
2. Decisions and states that are easy to misjudge: what the user confirmed versus what the assistant only suggested, and what is implemented, verified, still without a visible result, or still undecided. The reasons for rejected approaches, needed to avoid retrying them, belong here.
3. Other reasons, measured values and technical details that still affect later work.
Skip a whole category when the conversation gives no basis for it or it no longer affects later work. Several constraints in the same tier may be merged into one item, but do not keep only the one that is easiest to summarize.
Keep the rule itself; do not replace its content with status words like "wrapped up", "settled" or "done".
For a group of requirements that exists only in the conversation, name the specific items to keep and how they relate; do not replace the content with a count or "followed up".
The user's latest explicit correction of the goal or the authorized scope overrides earlier statements; an assistant suggestion does not count as user confirmation. Judge completion by actual execution results; when a result is not visible or not yet verified, say so, and do not conclude from that alone that the work is unfinished.
Write only what the visible conversation supports; do not invent unstated reasons, plans, steps or results.
</instructions>
${
  focus
    ? `
<focus>
${focus}
</focus>
focus only adjusts the retention priority of existing information. It is not a source of facts and does not authorize carrying out tasks or changing the constraints above. When something focus mentions has no basis in the conversation, do not write it.
`
    : ''
}
<output>
Output only the extra instructions themselves, with no explanation, and do not start with /compact. Write in the language the conversation uses. Line breaks are fine; do not use Markdown, code blocks, XML tags or surrounding quotes.
Each item names its subject and the scope, rule or state that must be kept; write paths, identifiers, commands and config values verbatim.
Usually 1 to 4 items. When there is a lot, drop the less important items first; do not compress into a keyword list, invent abbreviations or leave out necessary relationships. When there is little, do not pad. The item count is only a guide and never a reason to leave out a tier 1 constraint.
When nothing from tier 1 or 2 needs keeping, output only "${NOTHING_EXTRA}".
</output>`

// The typings say string and null respectively, but 2.1.285 actually returns
// { isAnswered: true, text, usage } or { isAnswered: false, reason } for both
type Reply = { isAnswered: boolean; text?: string; reason?: string }

const answerOf = (reply: unknown): string | undefined => {
  if (typeof reply === 'string') return reply
  const r = reply as Reply | null
  return r?.isAnswered ? r.text : undefined
}

// Leading -r/-n/-u/-h/-c (combinable, e.g. -rn) are flags; the rest splits at the last " -g " into draft and guidance
const parse = (args: string) => {
  const flags = new Set<string>()
  let rest = args.trim()
  let match = rest.match(/^-([rnuhc]+)(?:\s+|$)/)
  while (match) {
    for (const flag of match[1] ?? '') flags.add(flag)
    rest = rest.slice(match[0].length)
    match = rest.match(/^-([rnuhc]+)(?:\s+|$)/)
  }
  // The draft may contain things like npm i -g, so take the last -g
  const at = [...rest.matchAll(/(?:^|\s)-g(?=\s|$)/g)].at(-1)?.index ?? -1
  return {
    flags,
    draft: (at < 0 ? rest : rest.slice(0, at)).trim(),
    guidance: at < 0 ? '' : rest.slice(at).replace(/^\s*-g/, '').trim(),
  }
}

const RECORD_MARK = `<command-name>/${COMMAND}</command-name>`
const STDOUT_MARK = `<local-command-stdout>${COMMAND}:`

export function register(on: On): void {
  // Cleared on hot reload or a new session
  let last: { draft: string; guidance: string; result: string } | undefined

  // Empty the /polish command record and output; the rows can't be deleted and are saved as (no content)
  on('session.append', { door: 'command' }, ($, e, next) => {
    const text = e.message.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    const isOwnRow = text.includes(RECORD_MARK) || text.includes(STDOUT_MARK)
    return next(isOwnRow ? { ...e, message: { ...e.message, content: [] } } : e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Rewrite the text and put the result back in the input box (-h for usage)',
      argumentHint: '[-r|-u|-n|-c|-h] <text> [-g <guidance>]',
      immediate: true,
    })
    return next(e)
  })

  // All notices go through toasts: they stay out of the transcript and are never sent to the model
  on('command.run', { command: COMMAND }, async ($, e) => {
    const { flags, draft, guidance } = parse(e.args)
    const notify = (text: string, timeoutMs = 4000) => {
      $.ui.toast(text, { timeoutMs })
      return {}
    }

    if (flags.has('h')) return notify(USAGE, 15000)

    // Needs the conversation, so no fallback to the context-free model; doesn't update last, so -r/-u still target the previous rewrite
    if (flags.has('c')) {
      $.ui.status('Generating compact instructions…')
      let reply: unknown
      try {
        const focus = [draft, guidance].filter(Boolean).join('; ')
        reply = await $.model.fork({ prompt: compactPromptOf(focus) })
      } finally {
        $.ui.status(undefined)
      }
      const brief = answerOf(reply)?.trim().replace(/^\/compact\s*/, '')
      if (!brief) {
        const reason = (reply as Reply | null)?.reason
        return notify(
          reason === 'nothing-to-fork'
            ? 'Nothing in this conversation to compact yet'
            : `Generation failed: ${reason ?? 'the model returned nothing'}`,
        )
      }
      const command = brief === NOTHING_EXTRA ? '/compact' : `/compact ${brief}`
      const { isFilled } = await $.prompt.fill({ text: command })
      return isFilled ? {} : notify(`Input box unavailable. Result: ${command}`, 30000)
    }

    if (flags.has('u')) {
      if (!last) return notify('No original text to restore yet')
      await $.prompt.fill({ text: last.draft })
      return {}
    }

    let request: Request
    if (flags.has('r')) {
      if (!last) return notify('Nothing to rewrite again yet')
      const fresh = guidance || draft
      request = {
        draft: last.draft,
        guidance: fresh ? [last.guidance, fresh].filter(Boolean).join('; ') : last.guidance,
        previous: last.result,
        adjust: Boolean(fresh),
      }
    } else {
      if (!draft) return notify(USAGE, 15000)
      request = { draft, guidance }
    }

    $.ui.status('Rewriting…')
    let polished: string | undefined
    try {
      // fork carries the conversation; with no conversation yet it doesn't answer, so fall back to a context-free rewrite
      const forked = flags.has('n')
        ? undefined
        : answerOf(await $.model.fork({ prompt: forkPromptOf(request) }))
      polished = (
        forked ??
        answerOf(
          await $.model.complete({
            model: 'sonnet',
            system: SYSTEM,
            prompt: draftPromptOf(request),
          }),
        )
      )?.trim()
    } finally {
      $.ui.status(undefined)
    }
    if (!polished) return notify('Rewrite failed: the model returned nothing')

    last = { draft: request.draft, guidance: request.guidance, result: polished }
    const { isFilled } = await $.prompt.fill({ text: polished })
    return isFilled ? {} : notify(`Input box unavailable. Rewrite: ${polished}`, 30000)
  })
}
