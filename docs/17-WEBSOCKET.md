# WebSocket Specification

## Purpose
Realtime streaming and task progress.

## Channels
Conceptually:
- user/session
- task
- device

## Events
- task.created
- task.started
- task.progress
- task.tool_call
- task.waiting_approval
- task.completed
- task.failed
- artifact.created
- agent.connected
- agent.disconnected
- chat.delta
- chat.completed

## Event Envelope
```json
{
  "event": "task.progress",
  "taskId": "task_123",
  "timestamp": "2026-01-01T10:00:00Z",
  "data": {}
}
```

## Requirements
- authenticated connection
- heartbeat
- reconnect support
- event ordering where required
- duplicate tolerance
- server-side authorization
