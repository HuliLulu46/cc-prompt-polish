# polish

A Claude Code mod that adds `/polish`: it rewrites a rough prompt into a clearer one and leaves the result in the input box, so you can read and edit it before sending. Neither the command nor its result goes into the conversation.

## Usage

```
/polish <text>                 rewrite the text
/polish <text> -g <guidance>   rewrite with extra guidance, e.g. -g keep it short
/polish -r [guidance]          rewrite the last draft again; with guidance, adjust the last result instead
/polish -u                     put the last original text back
/polish -n <text>              rewrite without reading the conversation
/polish -c [focus]             fill the input box with /compact plus instructions on what to keep
/polish -h                     show usage
```

- The rewrite keeps the draft's meaning, language and technical details (paths, commands, identifiers) and adds no new requirements.
- By default it reads the conversation, so references like "that file" become concrete. With no conversation yet, or with `-n`, it rewrites the text alone.
- Only the last `-g` splits the guidance off, so a draft can contain things like `npm i -g foo`.
- Flags combine, such as `-rn`.
- `-c` writes `/compact` instructions naming the constraints, decisions and states that are easy to lose in a summary; with nothing to add it fills a bare `/compact`.
- Notices appear as toasts; if the input box is busy, the result shows in a toast instead.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install polish --marketplace HuliLulu46/polish
```

Answer `y` to add the marketplace, then pick a scope (user is first).

From a shell:

```
claude plugin install polish --marketplace HuliLulu46/polish
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `HuliLulu46/polish`, then Add plugin.

## Known limits

- `-r` and `-u` remember only the last rewrite of the current session, and forget it when the session restarts.
- The rewrite without conversation uses `sonnet`.

Built against Claude Code 2.1.300. A mod is an early-access API that may change between releases.

## Develop

```
claude plugin validate .
claude plugin test .
tsc -p .
```
