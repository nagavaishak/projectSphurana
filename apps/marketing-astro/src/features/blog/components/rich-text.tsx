import { documentToReactComponents } from '@contentful/rich-text-react-renderer';
import type { Options } from '@contentful/rich-text-react-renderer';
import { BLOCKS, INLINES } from '@contentful/rich-text-types';
import type { Block, Document, Inline } from '@contentful/rich-text-types';
import Image from 'next/image';
import type { ReactNode } from 'react';

const renderOptions: Options = {
  renderNode: {
    [BLOCKS.PARAGRAPH]: (_node: Block | Inline, children: ReactNode) => (
      <p className="mb-4 leading-7 text-muted-foreground">{children}</p>
    ),
    [BLOCKS.HEADING_1]: (_node: Block | Inline, children: ReactNode) => (
      <h1 className="text-3xl font-bold mt-10 mb-4">{children}</h1>
    ),
    [BLOCKS.HEADING_2]: (_node: Block | Inline, children: ReactNode) => (
      <h2 className="text-2xl font-semibold mt-8 mb-4">{children}</h2>
    ),
    [BLOCKS.HEADING_3]: (_node: Block | Inline, children: ReactNode) => (
      <h3 className="text-xl font-semibold mt-6 mb-3">{children}</h3>
    ),
    [BLOCKS.HEADING_4]: (_node: Block | Inline, children: ReactNode) => (
      <h4 className="text-lg font-medium mt-4 mb-2">{children}</h4>
    ),
    [BLOCKS.HEADING_5]: (_node: Block | Inline, children: ReactNode) => (
      <h5 className="text-base font-medium mt-4 mb-2">{children}</h5>
    ),
    [BLOCKS.HEADING_6]: (_node: Block | Inline, children: ReactNode) => (
      <h6 className="text-sm font-medium mt-4 mb-2">{children}</h6>
    ),
    [BLOCKS.UL_LIST]: (_node: Block | Inline, children: ReactNode) => (
      <ul className="mb-4 ml-6 list-disc space-y-1">{children}</ul>
    ),
    [BLOCKS.OL_LIST]: (_node: Block | Inline, children: ReactNode) => (
      <ol className="mb-4 ml-6 list-decimal space-y-1">{children}</ol>
    ),
    [BLOCKS.LIST_ITEM]: (_node: Block | Inline, children: ReactNode) => (
      <li className="leading-7 text-muted-foreground">{children}</li>
    ),
    [BLOCKS.QUOTE]: (_node: Block | Inline, children: ReactNode) => (
      <blockquote className="my-6 border-l-4 border-primary/30 pl-4 italic text-muted-foreground">
        {children}
      </blockquote>
    ),
    [BLOCKS.HR]: () => <hr className="my-8 border-border" />,
    [BLOCKS.EMBEDDED_ASSET]: (node: Block | Inline) => {
      const fields = node.data?.target?.fields as
        | Record<string, unknown>
        | undefined;
      if (!fields) return null;
      const file = fields.file as
        | {
            url: string;
            details: { image?: { width: number; height: number } };
          }
        | undefined;
      if (!file?.url) return null;
      const url = file.url.startsWith('//') ? `https:${file.url}` : file.url;
      const alt =
        (fields.title as string) || (fields.description as string) || '';
      const width = file.details?.image?.width || 800;
      const height = file.details?.image?.height || 450;

      return (
        <figure className="my-8">
          <Image
            src={url}
            alt={alt}
            width={width}
            height={height}
            className="w-full rounded-lg"
          />
          {typeof fields.description === 'string' && (
            <figcaption className="mt-2 text-center text-sm text-muted-foreground">
              {fields.description}
            </figcaption>
          )}
        </figure>
      );
    },
    [INLINES.HYPERLINK]: (node: Block | Inline, children: ReactNode) => {
      const url = (node.data?.uri as string) || '#';
      const isSafe =
        url === '#' ||
        url.startsWith('/') ||
        url.startsWith('https://') ||
        url.startsWith('http://') ||
        url.startsWith('mailto:') ||
        url.startsWith('tel:');
      const safeUrl = isSafe ? url : '#';
      const isExternal = safeUrl.startsWith('http');

      return (
        <a
          href={safeUrl}
          className="text-primary underline underline-offset-4 hover:text-primary/80"
          {...(isExternal
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {children}
        </a>
      );
    },
  },
};

export function RichText({ content }: { content: Document }) {
  if (!content) return null;
  return (
    <div className="max-w-none">
      {documentToReactComponents(content, renderOptions)}
    </div>
  );
}
