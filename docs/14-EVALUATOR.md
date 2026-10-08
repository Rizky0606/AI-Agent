# Evaluator Architecture

## Purpose
Prevent the system from claiming success without verification.

## Coding Evaluation
- requirements
- typecheck
- lint
- unit/integration tests
- build
- security checks
- visual QA when relevant

## Research Evaluation
- source quality
- citations
- cross-checking
- contradictions
- completeness

## Browser Evaluation
- expected state
- actual state
- DOM/accessibility state
- screenshots

## Evaluation Result
```ts
{
  passed: boolean;
  score?: number;
  findings: Finding[];
  recommendations: string[];
}
```

## Self-correction
If evaluation fails and the task budget permits:
Evaluate -> diagnose -> fix -> test -> evaluate again.

## Definition of Done
Requirement satisfied + execution successful + validation passed + evaluator passed.
