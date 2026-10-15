import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const answered = (text: string) => ({ value: { isAnswered: true as const, text, usage } })

const stubs = (on: On, fork: (prompt: string) => string | undefined) => {
  const seen = {
    fills: [] as string[],
    toasts: [] as string[],
    forks: [] as string[],
    completes: [] as { model: string; system?: string }[],
  }
  on('model.fork', ($, e) => {
    seen.forks.push(e.prompt)
    const text = fork(e.prompt)
    return text === undefined
      ? { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
      : answered(text)
  })
  on('model.complete', ($, e) => {
    seen.completes.push({ model: e.model, system: e.system })
    return answered('completed rewrite')
  })
  on('prompt.fill', ($, e) => {
    seen.fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  return seen
}

const run = (args: string) => ({
  command: 'polish',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

test('rewrites through fork, then -u restores the draft', async ($, on) => {
  const seen = stubs(on, () => '  forked rewrite  ')
  await $.command.run(run('改一下 npm i -g foo -g 简短点'))
  expect(seen.forks[0]).toContain('<draft>\n改一下 npm i -g foo\n</draft>')
  expect(seen.forks[0]).toContain('<guidance>\n简短点\n</guidance>')
  expect(seen.completes).toEqual([])
  expect(seen.fills).toEqual(['forked rewrite'])

  await $.command.run(run('-u'))
  expect(seen.fills.at(-1)).toBe('改一下 npm i -g foo')
})

test('falls back to sonnet when there is nothing to fork', async ($, on) => {
  const seen = stubs(on, () => undefined)
  await $.command.run(run('帮我看看'))
  expect(seen.completes[0]?.model).toBe('sonnet')
  expect(seen.completes[0]?.system).toContain('same language as the draft')
  expect(seen.fills).toEqual(['completed rewrite'])
})

test('-c with nothing extra fills a bare /compact', async ($, on) => {
  const seen = stubs(on, () => 'NONE')
  await $.command.run(run('-c'))
  expect(seen.fills).toEqual(['/compact'])
})

test('no text shows usage', async ($, on) => {
  const seen = stubs(on, () => 'x')
  await $.command.run(run(''))
  expect(seen.toasts[0]).toContain('-g guidance')
  expect(seen.fills).toEqual([])
})
