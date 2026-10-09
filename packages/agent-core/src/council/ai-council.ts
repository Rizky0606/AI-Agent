import type {
  CouncilDeliberationResult,
  CouncilJudgeEvaluation,
  CouncilLimits,
  CouncilParticipant,
  EvidenceItem,
  ParticipantOpinion,
} from './types.ts';

export interface ResolvedCouncilLimits {
  maxParticipants: number;
  maxRounds: number;
  maxTotalTokens: number;
  maxCostUsd: number;
  timeoutMs: number;
}

export type OpinionGenerator = (
  participant: CouncilParticipant,
  round: number,
  topic: string,
  evidence: EvidenceItem[],
  previousOpinions: ParticipantOpinion[],
) => Promise<ParticipantOpinion>;

export class AiCouncil {
  readonly participants: readonly CouncilParticipant[];
  readonly limits: ResolvedCouncilLimits;
  private readonly opinionGenerator?: OpinionGenerator | undefined;

  constructor(
    participants: CouncilParticipant[],
    limits?: CouncilLimits | undefined,
    opinionGenerator?: OpinionGenerator | undefined,
  ) {
    if (participants.length > 3) {
      throw new Error(
        `AI Council strictly capped at maximum 3 participants per ADR 0003 (received ${participants.length}).`,
      );
    }
    if (participants.length === 0) {
      throw new Error('AI Council requires at least 1 participant.');
    }

    const maxRounds = limits?.maxRounds ?? 2;
    if (maxRounds > 2) {
      throw new Error(
        `AI Council strictly capped at maximum 2 rounds per ADR 0003 (received ${maxRounds}).`,
      );
    }

    this.participants = Object.freeze([...participants]);
    this.limits = {
      maxParticipants: 3,
      maxRounds,
      maxTotalTokens: limits?.maxTotalTokens ?? 16000,
      maxCostUsd: limits?.maxCostUsd ?? 0.1,
      timeoutMs: limits?.timeoutMs ?? 30000,
    };
    this.opinionGenerator = opinionGenerator;
  }

  async deliberate(
    topic: string,
    evidence: EvidenceItem[],
    options?: { sessionId?: string | undefined } | undefined,
  ): Promise<CouncilDeliberationResult> {
    const startTime = Date.now();
    const sessionId = options?.sessionId ?? `council-${Date.now()}`;
    const allOpinions: ParticipantOpinion[] = [];

    let totalTokens = 0;
    let totalCostUsd = 0;
    let status: CouncilDeliberationResult['status'] = 'completed';
    let roundsCompleted = 0;

    for (let round = 1; round <= this.limits.maxRounds; round++) {
      roundsCompleted = round;

      for (const participant of this.participants) {
        if (Date.now() - startTime > this.limits.timeoutMs) {
          status = 'timeout';
          break;
        }

        const opinion = await this.generateOpinion(
          participant,
          round,
          topic,
          evidence,
          allOpinions,
        );

        totalTokens += opinion.tokenCount;
        totalCostUsd += opinion.costUsd;
        allOpinions.push(opinion);

        if (totalTokens >= this.limits.maxTotalTokens || totalCostUsd >= this.limits.maxCostUsd) {
          status = 'budget_exhausted';
          break;
        }
      }

      if (status !== 'completed') {
        break;
      }

      // If round 1 has perfect consensus and supported by evidence, stop early
      if (round === 1) {
        const round1Stances = allOpinions.map((o) => o.stance);
        const allApprove = round1Stances.every((s) => s === 'approve');
        const allReject = round1Stances.every((s) => s === 'reject');
        if (allApprove || allReject) {
          break;
        }
      }
    }

    // Evidence-based judge evaluation
    const judgeEvaluation = this.evaluateJudgeVerdict(topic, evidence, allOpinions);

    return {
      sessionId,
      topic,
      status,
      roundsCompleted,
      totalTokens,
      totalCostUsd,
      durationMs: Date.now() - startTime,
      opinions: allOpinions,
      judgeEvaluation,
    };
  }

  private async generateOpinion(
    participant: CouncilParticipant,
    round: number,
    topic: string,
    evidence: EvidenceItem[],
    previousOpinions: ParticipantOpinion[],
  ): Promise<ParticipantOpinion> {
    if (this.opinionGenerator) {
      return this.opinionGenerator(participant, round, topic, evidence, previousOpinions);
    }

    // Default deterministic opinion generator based on evidence
    const failingEvidence = evidence.filter((e) => !e.passed);
    let stance: ParticipantOpinion['stance'] = 'approve';
    let argument = `Participant ${participant.name} (${participant.perspective}): Analyzed proposal on "${topic}".`;

    if (failingEvidence.length > 0) {
      stance = 'reject';
      argument += ` REJECTED due to ${failingEvidence.length} failing evidence items (${failingEvidence.map((e) => e.description).join(', ')}).`;
    } else {
      argument += ' APPROVED: All provided empirical evidence items passed verification.';
    }

    return {
      participantId: participant.id,
      round,
      stance,
      argument,
      citedEvidenceIds: evidence.map((e) => e.id),
      tokenCount: 250,
      costUsd: 0.001,
    };
  }

  private evaluateJudgeVerdict(
    _topic: string,
    evidence: EvidenceItem[],
    opinions: ParticipantOpinion[],
  ): CouncilJudgeEvaluation {
    const verifiedPassed = evidence.filter((e) => e.passed).length;
    const verifiedFailed = evidence.filter((e) => !e.passed).length;
    const totalVerifiedEvidence = evidence.length;

    // RULE: Empirical evidence trumps opinion polls.
    // If ANY empirical evidence failed (e.g. failing tests or security violation),
    // the judge strictly rejects or demands revision, regardless of participant votes!
    if (verifiedFailed > 0) {
      return {
        verdict: 'rejected',
        rationale: `Judge rejected proposal: Found ${verifiedFailed} failing empirical evidence items (tests/security). Empirical proof overrides participant opinions.`,
        evidenceWeighed: {
          totalVerifiedEvidence,
          verifiedPassed,
          verifiedFailed,
          unsubstantiatedClaimsCount: 0,
        },
        decisionBasis: 'empirical_evidence',
      };
    }

    if (totalVerifiedEvidence === 0) {
      return {
        verdict: 'needs_revision',
        rationale:
          'Judge withheld approval: No empirical evidence provided. Claims must be supported by automated test or inspection artifacts per Rule 7.',
        evidenceWeighed: {
          totalVerifiedEvidence: 0,
          verifiedPassed: 0,
          verifiedFailed: 0,
          unsubstantiatedClaimsCount: opinions.length,
        },
        decisionBasis: 'empirical_evidence',
      };
    }

    // All evidence passed. Check participant stances
    const latestOpinions = opinions.filter(
      (o) => o.round === Math.max(...opinions.map((op) => op.round)),
    );
    const rejections = latestOpinions.filter((o) => o.stance === 'reject').length;

    if (rejections > 0) {
      return {
        verdict: 'needs_revision',
        rationale: `Judge determined revision required: Evidence passed, but ${rejections} reviewers raised unaddressed structural concerns.`,
        evidenceWeighed: {
          totalVerifiedEvidence,
          verifiedPassed,
          verifiedFailed,
          unsubstantiatedClaimsCount: 0,
        },
        decisionBasis: 'consensus',
      };
    }

    return {
      verdict: 'approved',
      rationale: `Judge approved: All ${verifiedPassed} empirical evidence items passed and reviewers reached consensus.`,
      evidenceWeighed: {
        totalVerifiedEvidence,
        verifiedPassed,
        verifiedFailed,
        unsubstantiatedClaimsCount: 0,
      },
      decisionBasis: 'empirical_evidence',
    };
  }
}
