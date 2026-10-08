# Task and Queue Architecture

## Task States
queued
planning
running
waiting_approval
paused
failed
completed
cancelled

## Queue
BullMQ backed by Redis.

Queues:
- agent.tasks
- coding.tasks
- research.tasks
- browser.tasks
- sandbox.tasks
- evaluation.tasks
- notification.tasks

## Durable State
PostgreSQL stores authoritative task state.
Redis/BullMQ handles execution scheduling.

## Retry
Retry transient failures with exponential backoff.
Do not retry invalid credentials, denied permissions, or security violations.

## Checkpoint
Long-running tasks persist step/checkpoint information so workers can recover.

## Initial VPS Concurrency
Keep low on 2 OCPU / 12 GB RAM. Start with 1–2 concurrent agent tasks.
