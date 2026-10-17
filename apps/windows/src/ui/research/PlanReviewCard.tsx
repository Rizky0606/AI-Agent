import React, { useState } from 'react';
import { Plus, Trash2, Play, X, AlertCircle, HelpCircle } from 'lucide-react';
import type { ResearchSubQuestionState } from '@personal-ai-os/shared';
import { idID } from '../locales/id-ID.ts';

interface PlanReviewCardProps {
  initialSubQuestions: ResearchSubQuestionState[];
  onApproveAndStart: (subQuestions: ResearchSubQuestionState[]) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export const PlanReviewCard: React.FC<PlanReviewCardProps> = ({
  initialSubQuestions,
  onApproveAndStart,
  onCancel,
  isLoading = false,
}) => {
  const [subQuestions, setSubQuestions] = useState<ResearchSubQuestionState[]>(
    initialSubQuestions.length > 0
      ? initialSubQuestions
      : [
          {
            id: 'sub-1',
            question: '',
            searchQueries: [],
            status: 'waiting',
          },
        ],
  );
  const [newQuestionText, setNewQuestionText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleUpdateQuestion = (id: string, text: string) => {
    setSubQuestions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, question: text } : item)),
    );
    if (validationError) setValidationError(null);
  };

  const handleDeleteQuestion = (id: string) => {
    if (subQuestions.length <= 1) {
      setValidationError(idID.research.planReview.emptyQuestions);
      return;
    }
    setSubQuestions((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddQuestion = () => {
    if (!newQuestionText.trim()) return;
    const newId = `sub-${Date.now().toString(36)}`;
    setSubQuestions((prev) => [
      ...prev,
      {
        id: newId,
        question: newQuestionText.trim(),
        searchQueries: [newQuestionText.trim()],
        status: 'waiting',
      },
    ]);
    setNewQuestionText('');
    setValidationError(null);
  };

  const handleKeyDownNew = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddQuestion();
    }
  };

  const handleApprove = async () => {
    const validQuestions = subQuestions.filter((q) => q.question.trim().length > 0);
    if (validQuestions.length === 0) {
      setValidationError(idID.research.planReview.emptyQuestions);
      return;
    }
    await onApproveAndStart(validQuestions);
  };

  return (
    <div className="research-plan-card" role="region" aria-label={idID.research.planReview.title}>
      <div className="research-plan-header">
        <div className="research-plan-icon-wrap">
          <HelpCircle size={20} color="var(--accent-cyan)" />
        </div>
        <div className="research-plan-header-text">
          <h2 className="research-plan-title">{idID.research.planReview.title}</h2>
          <p className="research-plan-subtitle">{idID.research.planReview.subtitle}</p>
        </div>
      </div>

      {validationError && (
        <div className="research-plan-error" role="alert">
          <AlertCircle size={14} />
          <span>{validationError}</span>
        </div>
      )}

      <div className="research-subquestions-list">
        <h3 className="research-subquestions-heading">
          {idID.research.planReview.subQuestionsTitle} ({subQuestions.length})
        </h3>

        {subQuestions.map((sq, index) => (
          <div key={sq.id} className="research-subquestion-item">
            <span className="research-sq-number">{index + 1}</span>
            <input
              type="text"
              className="ui-input research-sq-input"
              value={sq.question}
              onChange={(e) => handleUpdateQuestion(sq.id, e.target.value)}
              placeholder={idID.research.planReview.subQuestionPlaceholder}
              disabled={isLoading}
              aria-label={`Sub-pertanyaan ${index + 1}`}
            />
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm research-sq-delete-btn"
              onClick={() => handleDeleteQuestion(sq.id)}
              disabled={subQuestions.length <= 1 || isLoading}
              title="Hapus sub-pertanyaan"
              aria-label={`Hapus sub-pertanyaan ${index + 1}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {/* Add new sub-question row */}
        <div className="research-add-sq-row">
          <input
            type="text"
            className="ui-input research-add-sq-input"
            value={newQuestionText}
            onChange={(e) => setNewQuestionText(e.target.value)}
            onKeyDown={handleKeyDownNew}
            placeholder={idID.research.planReview.addSubQuestion + '...'}
            disabled={isLoading}
            aria-label="Input sub-pertanyaan baru"
          />
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-sm research-add-sq-btn"
            onClick={handleAddQuestion}
            disabled={!newQuestionText.trim() || isLoading}
          >
            <Plus size={14} />
            <span>Tambah</span>
          </button>
        </div>
      </div>

      <div className="research-plan-actions">
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-md"
          onClick={onCancel}
          disabled={isLoading}
        >
          <X size={15} />
          <span>{idID.research.planReview.cancel}</span>
        </button>

        <button
          type="button"
          className="ui-btn ui-btn-primary ui-btn-md"
          onClick={() => void handleApprove()}
          disabled={isLoading}
        >
          <Play size={15} />
          <span>{isLoading ? 'Memulai...' : idID.research.planReview.approveAndStart}</span>
        </button>
      </div>
    </div>
  );
};
