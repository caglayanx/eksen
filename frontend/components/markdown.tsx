"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

type MarkdownRendererProps = {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ className: headingClassName, ...props }) => (
            <h1
              className={cn(
                "mt-8 mb-4 border-b border-blue-300/20 pb-2 text-2xl font-bold text-blue-100",
                headingClassName,
              )}
              {...props}
            />
          ),
          h2: ({ className: headingClassName, ...props }) => (
            <h2 className={cn("mt-6 mb-3 text-xl font-semibold text-blue-100", headingClassName)} {...props} />
          ),
          h3: ({ className: headingClassName, ...props }) => (
            <h3 className={cn("mt-4 mb-2 text-lg font-medium text-blue-200", headingClassName)} {...props} />
          ),
          h4: ({ className: headingClassName, ...props }) => (
            <h4 className={cn("mt-3 mb-2 text-base font-medium text-blue-200/80", headingClassName)} {...props} />
          ),
          table: ({ className: tableClassName, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-blue-300/10">
              <table className={cn("w-full border-collapse text-sm", tableClassName)} {...props} />
            </div>
          ),
          thead: ({ className: theadClassName, ...props }) => (
            <thead className={cn("border-b-2 border-blue-300/30 bg-blue-400/5", theadClassName)} {...props} />
          ),
          tbody: ({ className: tbodyClassName, ...props }) => <tbody className={tbodyClassName} {...props} />,
          tr: ({ className: rowClassName, ...props }) => (
            <tr className={cn("transition-colors hover:bg-blue-400/5", rowClassName)} {...props} />
          ),
          th: ({ className: cellClassName, ...props }) => (
            <th className={cn("px-4 py-3 text-left font-semibold text-blue-100", cellClassName)} {...props} />
          ),
          td: ({ className: cellClassName, ...props }) => (
            <td
              className={cn("border-t border-blue-300/10 px-4 py-2.5 text-blue-50/85", cellClassName)}
              {...props}
            />
          ),
          p: ({ className: paragraphClassName, ...props }) => (
            <p className={cn("my-3 text-sm leading-7 text-blue-100/80", paragraphClassName)} {...props} />
          ),
          ul: ({ className: listClassName, ...props }) => (
            <ul className={cn("my-3 ml-6 list-disc space-y-1.5", listClassName)} {...props} />
          ),
          ol: ({ className: listClassName, ...props }) => (
            <ol className={cn("my-3 ml-6 list-decimal space-y-1.5", listClassName)} {...props} />
          ),
          li: ({ className: itemClassName, ...props }) => (
            <li className={cn("text-sm leading-6 text-blue-100/80 marker:text-blue-300/60", itemClassName)} {...props} />
          ),
          code: ({ className: codeClassName, ...props }) => (
            <code
              className={cn(
                "rounded bg-blue-400/10 px-1.5 py-0.5 font-mono text-xs text-blue-200",
                codeClassName,
              )}
              {...props}
            />
          ),
          pre: ({ className: preClassName, ...props }) => (
            <pre
              className={cn(
                "my-4 overflow-x-auto rounded-xl border border-blue-300/10 bg-[#02050a] p-4 text-xs leading-relaxed text-blue-100/80",
                preClassName,
              )}
              {...props}
            />
          ),
          strong: ({ className: strongClassName, ...props }) => (
            <strong className={cn("font-semibold text-blue-100", strongClassName)} {...props} />
          ),
          em: ({ className: emClassName, ...props }) => <em className={cn("italic", emClassName)} {...props} />,
          hr: ({ className: hrClassName, ...props }) => (
            <hr className={cn("my-6 border-blue-300/10", hrClassName)} {...props} />
          ),
          blockquote: ({ className: blockquoteClassName, ...props }) => (
            <blockquote
              className={cn(
                "my-3 border-l-2 border-blue-400/30 pl-4 text-blue-200/70 italic",
                blockquoteClassName,
              )}
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
