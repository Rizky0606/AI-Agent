# Model Gateway

## Primary Provider
9Router OpenAI-compatible endpoint:
`https://9router.ojixx.my.id/v1`

The API key must remain server-side.

## Abstraction
```ts
interface ModelGateway {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
  listModels(): Promise<ModelInfo[]>;
}
```

## Provider Layout
packages/model-gateway/
- types
- router
- providers/9router

## Model Router Criteria
- task type
- reasoning capability
- coding capability
- vision
- context length
- latency
- cost
- availability

## Failover
Primary -> fallback -> secondary fallback.

## Usage Tracking
Store provider, model, tokens, latency, taskId, sessionId, and estimated cost.

## Security
- Never expose API keys to Android.
- Never log secrets.
- Apply timeout/retry/backoff.
