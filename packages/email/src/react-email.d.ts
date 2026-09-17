// Type override for @react-email/components to fix React 19 compatibility
// This is a temporary workaround until @react-email officially supports React 19
declare module '@react-email/components' {
  import type { FC, ReactNode, CSSProperties } from 'react';

  interface BaseProps {
    children?: ReactNode;
    style?: CSSProperties;
  }

  interface ButtonProps extends BaseProps {
    href?: string;
  }

  interface LinkProps extends BaseProps {
    href?: string;
  }

  interface TextProps extends BaseProps {}
  interface HrProps extends BaseProps {}
  interface HtmlProps extends BaseProps {}
  interface HeadProps extends BaseProps {}
  interface BodyProps extends BaseProps {}
  interface ContainerProps extends BaseProps {}
  interface SectionProps extends BaseProps {}
  interface PreviewProps extends BaseProps {}

  export const Html: FC<HtmlProps>;
  export const Head: FC<HeadProps>;
  export const Body: FC<BodyProps>;
  export const Container: FC<ContainerProps>;
  export const Section: FC<SectionProps>;
  export const Text: FC<TextProps>;
  export const Button: FC<ButtonProps>;
  export const Hr: FC<HrProps>;
  export const Preview: FC<PreviewProps>;
  export const Link: FC<LinkProps>;
}
