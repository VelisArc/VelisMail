import { Helmet } from 'react-helmet-async';

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

const SITE_NAME = 'VelisMail';
const DEFAULT_DESC = 'Secure business email platform for custom domains, scheduled send, mail queues, templates, team access, DNS verification, and encrypted enterprise communication.';
const DEFAULT_IMAGE = 'https://velismail.online/ZeeResizer.png';

export default function SEO({
  title,
  description = DEFAULT_DESC,
  image = DEFAULT_IMAGE,
  url = 'https://velismail.online',
}: SEOProps) {
  const pageTitle = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} - Secure Business Email Operations`;

  return (
    <Helmet>
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:url" content={url} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:url" content={url} />
    </Helmet>
  );
}
