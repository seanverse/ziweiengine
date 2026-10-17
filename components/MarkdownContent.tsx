'use client';
import type { CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  text: string;
  streaming?: boolean;
}

/** 把模型常用的 **【小节】** 归一成 Markdown 标题。 */
function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    // 标题独占一行
    .replace(/^\s*\*\*【(.+?)】\*\*\s*$/gm, '## 【$1】')
    .replace(/^\s*【(.+?)】\s*$/gm, '## 【$1】')
    // 标题和正文挤在同一行时强制断行
    .replace(/^\s*\*\*【(.+?)】\*\*\s*(.+)$/gm, '## 【$1】\n\n$2')
    .replace(/^\s*【(.+?)】\s*(.+)$/gm, '## 【$1】\n\n$2');
}

export default function MarkdownContent({ text, streaming }: MarkdownContentProps) {
  return (
    <div className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 style={headingStyle}>{children}</h2>,
          h2: ({ children }) => <h2 style={headingStyle}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ ...headingStyle, fontSize: '12px' }}>{children}</h3>,
          p: ({ children }) => (
            <p style={{ margin: '0 0 10px', fontSize: '13px', lineHeight: 1.85, color: 'var(--t-text2)' }}>
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong style={{ color: 'var(--t-text)', fontWeight: 600 }}>{children}</strong>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '4px 0 10px', paddingLeft: '20px', color: 'var(--t-text2)', fontSize: '13px', lineHeight: 1.85 }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '4px 0 10px', paddingLeft: '20px', color: 'var(--t-text2)', fontSize: '13px', lineHeight: 1.85 }}>
              {children}
            </ol>
          ),
          li: ({ children }) => <li style={{ marginBottom: '4px' }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote style={{
              margin: '8px 0 12px',
              padding: '8px 12px',
              borderLeft: '3px solid rgba(212,168,67,0.45)',
              background: 'rgba(212,168,67,0.06)',
              borderRadius: '0 8px 8px 0',
              color: 'var(--t-text2)',
              fontSize: '12px',
            }}>
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--t-gold)', textDecoration: 'underline' }}>
              {children}
            </a>
          ),
          hr: () => <hr style={{ border: 0, borderTop: '1px solid var(--t-border)', margin: '14px 0' }} />,
          code: ({ children }) => (
            <code style={{ background: 'var(--t-card)', padding: '1px 4px', borderRadius: '4px', fontSize: '12px' }}>
              {children}
            </code>
          ),
        }}
      >
        {normalizeMarkdown(text)}
      </ReactMarkdown>
      {streaming && (
        <span style={{
          display: 'inline-block',
          width: '7px',
          height: '13px',
          background: 'var(--t-gold)',
          opacity: 0.55,
          borderRadius: '2px',
          animation: 'pulse 1s ease-in-out infinite',
          verticalAlign: 'middle',
          marginLeft: '3px',
        }} />
      )}
    </div>
  );
}

const headingStyle: CSSProperties = {
  margin: '18px 0 8px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--t-gold)',
  letterSpacing: '0.05em',
};
