import React, { useState } from 'react';
import {
  Copy,
  Check,
  Download,
  ExternalLink,
  BarChart2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import {
  parseCitations,
  type ParsedCitation,
  type ResearchEvidenceItem,
  type ResearchReportData,
  type ResearchSourceItem,
} from '@personal-ai-os/shared';
import { idID } from '../locales/id-ID.ts';

interface ResearchReportViewerProps {
  report: ResearchReportData;
  sources: ResearchSourceItem[];
  evidence: ResearchEvidenceItem[];
  onOpenExternalLink: (url: string) => void;
}

export const ResearchReportViewer: React.FC<ResearchReportViewerProps> = ({
  report,
  sources,
  evidence,
  onOpenExternalLink,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeCitation, setActiveCitation] = useState<ParsedCitation | null>(null);

  const citationMap = parseCitations(report.contentMarkdown, sources, evidence);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(report.contentMarkdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard write failed
    }
  };

  const handleDownloadMd = () => {
    try {
      const blob = new Blob([report.contentMarkdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}.md`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // Download failed
    }
  };

  /**
   * Mengganti tanda sitasi [src-X] dengan elemen tombol interaktif.
   * Dijamin aman dan tidak crash jika citationId tidak ditemukan.
   */
  const renderTextWithCitations = (text: string): React.ReactNode => {
    const parts = text.split(/(\[src-\d+\])/g);
    return parts.map((part, index) => {
      const match = part.match(/^\[src-(\d+)\]$/);
      if (match) {
        const citationId = `src-${match[1]}`;
        const citation = citationMap.get(citationId) || {
          citationId,
          number: parseInt(match[1]!, 10),
          isValid: false,
          label: `[src-${match[1]}: Sumber tidak ditemukan]`,
        };

        return (
          <button
            key={index}
            type="button"
            className={`citation-badge-btn ${citation.isValid ? 'valid' : 'invalid'}`}
            onClick={() => setActiveCitation(citation)}
            title={citation.label}
            aria-label={citation.label}
          >
            [src-{citation.number}]
          </button>
        );
      }
      return <React.Fragment key={index}>{part}</React.Fragment>;
    });
  };

  /**
   * Render blok Markdown sederhana dengan dukungan sitasi interaktif
   */
  const renderMarkdownBlocks = (markdown: string): React.ReactNode => {
    const lines = markdown.split('\n');
    const nodes: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeContent = '';
    let codeLang = '';

    lines.forEach((line, index) => {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          nodes.push(
            <pre key={`code-${index}`} className="report-code-block">
              <code className={codeLang ? `language-${codeLang}` : undefined}>{codeContent}</code>
            </pre>,
          );
          inCodeBlock = false;
          codeContent = '';
        } else {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
        }
        return;
      }

      if (inCodeBlock) {
        codeContent += (codeContent ? '\n' : '') + line;
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        nodes.push(<div key={`sp-${index}`} className="report-paragraph-spacing" />);
        return;
      }

      if (trimmed.startsWith('# ')) {
        nodes.push(
          <h1 key={`h1-${index}`} className="report-h1">
            {renderTextWithCitations(trimmed.slice(2))}
          </h1>,
        );
      } else if (trimmed.startsWith('## ')) {
        nodes.push(
          <h2 key={`h2-${index}`} className="report-h2">
            {renderTextWithCitations(trimmed.slice(3))}
          </h2>,
        );
      } else if (trimmed.startsWith('### ')) {
        nodes.push(
          <h3 key={`h3-${index}`} className="report-h3">
            {renderTextWithCitations(trimmed.slice(4))}
          </h3>,
        );
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        nodes.push(
          <li key={`li-${index}`} className="report-list-item">
            {renderTextWithCitations(trimmed.slice(2))}
          </li>,
        );
      } else if (/^\d+\.\s/.test(trimmed)) {
        const match = trimmed.match(/^(\d+\.)\s(.*)$/);
        nodes.push(
          <div key={`num-${index}`} className="report-numbered-item">
            <span className="num-prefix">{match?.[1]}</span>
            <span>{renderTextWithCitations(match?.[2] ?? trimmed)}</span>
          </div>,
        );
      } else {
        nodes.push(
          <p key={`p-${index}`} className="report-paragraph">
            {renderTextWithCitations(line)}
          </p>,
        );
      }
    });

    return nodes;
  };

  const confidenceEntries = Object.entries(report.confidenceBySection || {});

  return (
    <div className="research-report-viewer" role="article" aria-label={report.title}>
      {/* Report Top Header */}
      <div className="report-viewer-header">
        <div className="report-header-info">
          <h1 className="report-title">{report.title}</h1>
          {report.summary && <p className="report-summary">{report.summary}</p>}
        </div>

        <div className="report-header-actions">
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-sm"
            onClick={handleCopy}
            title={idID.research.report.copyReport}
          >
            {copied ? <Check size={14} color="var(--accent-emerald)" /> : <Copy size={14} />}
            <span>{copied ? idID.research.report.copied : idID.research.report.copyReport}</span>
          </button>

          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-sm"
            onClick={handleDownloadMd}
            title={idID.research.report.saveMarkdown}
          >
            <Download size={14} />
            <span>{idID.research.report.saveMarkdown}</span>
          </button>
        </div>
      </div>

      {/* Confidence by Section Card */}
      {confidenceEntries.length > 0 && (
        <div className="report-confidence-card">
          <div className="confidence-card-header">
            <BarChart2 size={15} color="var(--accent-blue)" />
            <span>{idID.research.report.confidenceTitle}</span>
          </div>
          <div className="confidence-bars-grid">
            {confidenceEntries.map(([sec, score]) => {
              const pct = Math.round(score * 100);
              const colorClass = pct >= 80 ? 'high' : pct >= 60 ? 'medium' : 'low';
              return (
                <div key={sec} className="confidence-item">
                  <div className="confidence-item-header">
                    <span className="confidence-sec-name">{sec}</span>
                    <span className={`confidence-sec-pct ${colorClass}`}>{pct}%</span>
                  </div>
                  <div className="confidence-track">
                    <div className={`confidence-fill ${colorClass}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Markdown Body Content with Clickable Citations */}
      <div className="report-body-content">{renderMarkdownBlocks(report.contentMarkdown)}</div>

      {/* Information Gaps ("Yang Tidak Ditemukan") Section */}
      {report.gaps && report.gaps.length > 0 && (
        <div className="report-gaps-card" role="region" aria-label={idID.research.report.gapsTitle}>
          <div className="gaps-card-header">
            <AlertTriangle size={16} color="var(--accent-amber)" />
            <h3 className="gaps-card-title">{idID.research.report.gapsTitle}</h3>
          </div>
          <ul className="gaps-list">
            {report.gaps.map((gap, idx) => (
              <li key={idx} className="gaps-item">
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Interactive Citation Popover / Details Modal */}
      {activeCitation && (
        <div
          className="citation-modal-overlay"
          onClick={() => setActiveCitation(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Rincian Sitasi [src-${activeCitation.number}]`}
        >
          <div className="citation-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="citation-modal-header">
              <span className="citation-modal-num">[src-{activeCitation.number}]</span>
              <button
                type="button"
                className="citation-modal-close"
                onClick={() => setActiveCitation(null)}
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            {activeCitation.isValid && activeCitation.source ? (
              <div className="citation-modal-body">
                <div className="citation-source-domain-row">
                  <span className="domain-initials-badge">{activeCitation.source.initials}</span>
                  <span className="domain-text">{activeCitation.source.domain}</span>
                  <span className="credibility-badge">
                    Kredibilitas: {Math.round(activeCitation.source.credibilityScore * 100)}%
                  </span>
                </div>

                <h4 className="citation-source-title">{activeCitation.source.title}</h4>

                {activeCitation.quote && (
                  <div className="citation-quote-box">
                    <span className="quote-label">Kutipan Bukti Faktual:</span>
                    <p className="quote-text">"{activeCitation.quote}"</p>
                  </div>
                )}

                <div className="citation-modal-actions">
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm"
                    onClick={() => {
                      if (activeCitation.source?.url) {
                        onOpenExternalLink(activeCitation.source.url);
                      }
                      setActiveCitation(null);
                    }}
                  >
                    <ExternalLink size={13} />
                    <span>Buka Sumber Asli</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="citation-modal-empty">
                <Info size={18} color="var(--text-muted)" />
                <p>Sumber rujukan untuk sitasi [src-{activeCitation.number}] tidak ditemukan pada catatan riset.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
