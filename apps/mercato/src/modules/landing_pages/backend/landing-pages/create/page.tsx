'use client'

import { useWizardState } from '@/lib/landing-page-wizard/hooks/useWizardState'
import { WizardShell } from '@/lib/landing-page-wizard/components/WizardShell'

export default function CreateLandingPage() {
  const wizard = useWizardState()

  return <WizardShell wizard={wizard} />
}
