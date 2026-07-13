import type { Metadata } from 'next';

import { EmailComingSoon } from '@/components/auth/email-coming-soon';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return <EmailComingSoon heading="Reset your password" />;
}
