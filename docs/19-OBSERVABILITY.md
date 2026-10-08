# Observability Specification

## Stack
- OpenTelemetry
- Prometheus
- Grafana
- structured JSON logging

## Metrics
- API latency
- first-token latency
- model latency
- token usage
- queue depth
- queue latency
- task duration
- tool latency
- worker health
- Windows Agent health
- sandbox health
- error rate
- CPU/RAM usage

## Tracing
Every request/task should have traceId and taskId where applicable.

## Logs
Structured logs must include:
- timestamp
- level
- service
- traceId
- taskId
- user/device context when safe
- event
- error code

Never log secrets, tokens, cookies, or raw credentials.
