import React, { useState } from 'react';
import { Check, Copy, ExternalLink, ShieldAlert } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from './Button.tsx';
import { Dialog } from './Dialog.tsx';
import {
  type BlockToken,
  type InlineToken,
  parseMarkdown,
} from './markdown-parser.ts';
import './Components.css';

export interface MarkdownMessageProps {
  content: string;
  className?: string;
  onOpenExternalLink?: (url: string) => Promise<void> | void;
}

const CodeBlockView: React.FC<{ language: string; content: string }> = ({
  language,
  content,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard write failed (e.g. non-secure context)
    }
  };

  return (
    <div className="ui-code-block">
      <div className="ui-code-header">
        <span className="ui-code-lang">{language || 'teks'}</span>
        <button
          type="button"
          className="ui-code-copy-btn"
          onClick={handleCopy}
          aria-label={copied ? 'Tersalin ke papan klip' : 'Salin kode'}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span>{copied ? 'Tersalin!' : 'Salin'}</span>
        </button>
      </div>
      <pre className="ui-code-content">
        <code>{content}</code>
      </pre>
    </div>
  );
};

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  className = '',
  onOpenExternalLink,
}) => {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const handleLinkClick = (e: React.MouseEvent, url: string, isSafe: boolean) => {
    e.preventDefault();
    if (!isSafe) {
      return;
    }
    setPendingUrl(url);
  };

  const confirmOpenLink = async () => {
    if (!pendingUrl) return;
    const url = pendingUrl;
    setPendingUrl(null);

    if (onOpenExternalLink) {
      await onOpenExternalLink(url);
      return;
    }

    try {
      await invoke('open_external_url', { url });
    } catch {
      // Fallback for browser / preview environments
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const renderInline = (token: InlineToken, index: number): React.ReactNode => {
    switch (token.type) {
      case 'text':
        return <React.Fragment key={index}>{token.text}</React.Fragment>;
      case 'bold':
        return (
          <strong key={index}>
            {token.children.map((child, i) => renderInline(child, i))}
          </strong>
        );
      case 'italic':
        return (
          <em key={index}>
            {token.children.map((child, i) => renderInline(child, i))}
          </em>
        );
      case 'strike':
        return (
          <del key={index}>
            {token.children.map((child, i) => renderInline(child, i))}
          </del>
        );
      case 'inline-code':
        return (
          <code key={index} className="ui-inline-code">
            {token.code}
          </code>
        );
      case 'link':
        if (!token.isSafe) {
          return (
            <span
              key={index}
              className="ui-markdown-link-unsafe"
              title="Tautan tidak aman dicegah oleh sistem"
            >
              <ShieldAlert size={12} aria-hidden="true" />
              <span>{token.text || '[Tautan Tidak Aman]'}</span>
            </span>
          );
        }
        return (
          <a
            key={index}
            href={token.href}
            className="ui-markdown-link"
            onClick={(e) => handleLinkClick(e, token.href, token.isSafe)}
            title={`Buka ${token.href} di browser eksternal`}
          >
            {token.text}
            <ExternalLink size={11} aria-hidden="true" className="ui-markdown-link-icon" />
          </a>
        );
      default:
        return null;
    }
  };

  const renderBlock = (block: BlockToken, index: number): React.ReactNode => {
    switch (block.type) {
      case 'heading': {
        const HeadingTag = `h${block.level}` as keyof JSX.IntrinsicElements;
        return (
          <HeadingTag key={index}>
            {block.inlines.map((inline, i) => renderInline(inline, i))}
          </HeadingTag>
        );
      }
      case 'codeblock':
        return (
          <CodeBlockView
            key={index}
            language={block.language}
            content={block.content}
          />
        );
      case 'blockquote':
        return (
          <blockquote key={index}>
            {block.inlines.map((inline, i) => renderInline(inline, i))}
          </blockquote>
        );
      case 'list': {
        const ListTag = block.ordered ? 'ol' : 'ul';
        return (
          <ListTag key={index}>
            {block.items.map((item, itemIdx) => (
              <li key={itemIdx}>
                {item.map((inline, i) => renderInline(inline, i))}
              </li>
            ))}
          </ListTag>
        );
      }
      case 'table':
        return (
          <div key={index} className="ui-table-wrapper">
            <table>
              <thead>
                <tr>
                  {block.headers.map((h, hIdx) => (
                    <th key={hIdx}>
                      {h.map((inline, i) => renderInline(inline, i))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx}>
                        {cell.map((inline, i) => renderInline(inline, i))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'paragraph':
        return (
          <p key={index}>
            {block.inlines.map((inline, i) => renderInline(inline, i))}
          </p>
        );
      default:
        return null;
    }
  };

  const blocks = parseMarkdown(content);

  return (
    <div className={`ui-markdown ${className}`.trim()}>
      {blocks.map((block, idx) => renderBlock(block, idx))}

      {/* Confirmation Dialog for opening external links */}
      <Dialog
        isOpen={Boolean(pendingUrl)}
        onClose={() => setPendingUrl(null)}
        title="Buka Tautan Luar"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingUrl(null)}>
              Batal
            </Button>
            <Button variant="primary" onClick={confirmOpenLink}>
              Buka di Browser
            </Button>
          </>
        }
      >
        <p>Apakah Anda yakin ingin membuka tautan luar berikut di peramban sistem?</p>
        <p className="ui-markdown-dialog-url">
          <code>{pendingUrl}</code>
        </p>
      </Dialog>
    </div>
  );
};
