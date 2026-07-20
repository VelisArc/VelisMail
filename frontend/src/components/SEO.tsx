import { Helmet } from 'react-helmet-async';
import type { ReactElement } from 'react';

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  canonicalUrl?: string;
  keywords?: string[];
  articlePublishedTime?: string;
  articleModifiedTime?: string;
}

const SITE_NAME = 'VelisMail';
const DEFAULT_TITLE = 'VelisMail - Secure Business Email Operations';
const DEFAULT_DESC = 'Secure business email platform for custom domains, scheduled send, mail queues, templates, team access, DNS verification, and encrypted enterprise communication.';
const DEFAULT_IMAGE = 'https://velismail.online/ZeeResizer.png';
const DEFAULT_URL = 'https://velismail.online';
const DEFAULT_KEYWORDS = ['secure email', 'business email', 'encrypted email', 'enterprise email', 'email hosting', 'custom domain email', 'zero trust email'];

export default function SEO({
  title,
  description = DEFAULT_DESC,
  image = DEFAULT_IMAGE,
  url = DEFAULT_URL,
  canonicalUrl,
  keywords = DEFAULT_KEYWORDS,
  articlePublishedTime,
  articleModifiedTime,
}: SEOProps): ReactElement {
  const pageTitle = title ? `${title} — ${SITE_NAME}` : DEFAULT_TITLE;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{pageTitle}</title>
      <meta name="title" content={pageTitle} />
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords.join(', ')} />
      <meta name="author" content={SITE_NAME} />
      <link rel="canonical" href={canonicalUrl || url} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:url" content={url} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:url" content={url} />

      {/* Article metadata (for blog posts or news articles) */}
      {articlePublishedTime && <meta property="article:published_time" content={articlePublishedTime} />}
      {articleModifiedTime && <meta property="article:modified_time" content={articleModifiedTime} />}

      {/* Robots */}
      <meta name="robots" content="index, follow" />

      {/* Additional SEO enhancements */}
      <meta name="theme-color" content="#0d9488" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
    </Helmet>
  );
}
