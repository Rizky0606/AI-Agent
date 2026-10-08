# Agent Kernel Specification

## Responsibility
Agent Kernel is the orchestration brain. It converts user intent into durable, executable, observable tasks.

## Modules
- Intent Analyzer
- Planner
- Task Manager
- Agent Router
- Model Router
- Context Manager
- Memory Manager
- Tool Manager
- Runtime Manager
- Permission Engine
- Evaluator
- Scheduler
- Event Engine

## Request Lifecycle
1. Authenticate
2. Load project/session
3. Analyze intent
4. Retrieve context
5. Create plan when needed
6. Create task
7. Route model/runtime
8. Execute tools
9. Evaluate
10. Verify
11. Persist result
12. Notify client

## Runtime Contract
```ts
interface AgentRuntime {
  initialize(): Promise<void>;
  execute(task: AgentTask): Promise<AgentResult>;
  pause(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  healthCheck(): Promise<RuntimeHealth>;
}
```

## Rules
- Kernel must not contain provider-specific implementation.
- Kernel must not execute privileged operations directly.
- Every tool call passes through Tool Manager and Permission Engine.
- Every durable task has persistent state.
