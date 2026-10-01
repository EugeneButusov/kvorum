# AI provider architecture

`LLMClient` is the application port. Completion features request a provider-neutral
`fast` or `strong` model tier; `AI_LLM_PROVIDER=anthropic|openai` selects the adapter,
and the generation-profile registry resolves the exact model. The default is
`anthropic`.

Current profiles:

| Tier     | Anthropic          | OpenAI        |
| -------- | ------------------ | ------------- |
| `fast`   | `claude-haiku-4-5` | `gpt-6-luna`  |
| `strong` | `claude-sonnet-5`  | `gpt-6.1-sol` |

Outputs are cached by feature, prompt version, input hash, and generation profile.
API reads prefer the active profile and temporarily fall back to the newest prior
profile while a provider rollout fills the new cache.

## Building

Run `pnpm --filter ai build` to build the library.

## Running unit tests

Run `pnpm --filter ai test` to execute the unit tests via [Vitest](https://vitest.dev/).
