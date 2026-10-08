# Scheduler and Event Architecture

## Scheduler
Use a durable scheduler integrated with BullMQ.

Examples:
- daily research
- weekly reports
- website checks
- periodic maintenance

## Event Triggers
- GitHub issue
- new email
- calendar event
- website change
- server error
- file creation
- scheduled event

## Flow
Trigger -> Event Engine -> Create Task -> Queue -> Agent -> Evaluate -> Notify.

## Reliability
Scheduled definitions live in PostgreSQL.
Execution jobs live in BullMQ/Redis.
Execution history is persisted in PostgreSQL.

## Idempotency
Event handlers should use event IDs to avoid duplicate task creation.
