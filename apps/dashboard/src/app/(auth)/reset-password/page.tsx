import type { Metadata } from 'next';

import { EmailComingSoon } from '@/components/auth/email-coming-soon';

export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPasswordPage() {
  return <EmailComingSoon heading="Set a new password" />;
}
