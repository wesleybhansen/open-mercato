'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import type { WizardActions } from '../hooks/useWizardState'
import { Step1PageType } from './Step1PageType'
import { Step2SubType } from './Step2SubType'
import { Step3AboutBusiness } from './Step3AboutBusiness'
import { Step4AboutOffer } from './Step4AboutOffer'
import { Step5CrmSettings } from './Step5CrmSettings'
import { Step5CopyReview } from './Step5CopyReview'
import { Step6ChooseStyle } from './Step6ChooseStyle'
import { Step7PreviewPublish } from './Step7PreviewPublish'

const ALL_STEP_LABELS = [
  { key: 0, label: 'Page Type' },
  { key: 1, label: 'Sub-Type' },
  { key: 2, label: 'Your Business' },
  { key: 3, label: 'Your Offer' },
  { key: 4, label: 'Delivery & Pipeline', skipFor: ['upsell', 'downsell', 'funnel-checkout'] },
  { key: 5, label: 'Review Copy' },
  { key: 6, label: 'Choose Style' },
  { key: 7, label: 'Preview & Publish' },
]

interface WizardShellProps {
  wizard: WizardActions
}

export function WizardShell({ wizard }: WizardShellProps) {
  const { state, prevStep, reset } = wizard
  const router = useRouter()
  const currentStep = state.step
  const contentRef = useRef<HTMLDivElement>(null)

  // Scroll to top on step change
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [currentStep])

  const handleBack = () => {
    if (currentStep === 0) {
      router.push('/backend/landing-pages')
    } else {
      prevStep()
    }
  }

  // Funnel page types skip the CRM settings step (step 4)
  const skipCrmSettings = ['upsell', 'downsell', 'funnel-checkout'].includes(state.pageType || '')

  const renderStep = () => {
    // If we land on step 4 and should skip it, auto-advance
    if (currentStep === 4 && skipCrmSettings) {
      wizard.nextStep()
      return null
    }

    switch (currentStep) {
      case 0: return <Step1PageType wizard={wizard} />
      case 1: return <Step2SubType wizard={wizard} />
      case 2: return <Step3AboutBusiness wizard={wizard} />
      case 3: return <Step4AboutOffer wizard={wizard} />
      case 4: return <Step5CrmSettings wizard={wizard} />
      case 5: return <Step5CopyReview wizard={wizard} />
      case 6: return <Step6ChooseStyle wizard={wizard} />
      case 7: return <Step7PreviewPublish wizard={wizard} />
      default: return <Step1PageType wizard={wizard} />
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b bg-card">
        <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
          <ArrowLeft className="size-4" />
          Back
        </Button>

        <div className="flex-1">
          {/* Progress dots */}
          {(() => {
            const visibleSteps = ALL_STEP_LABELS.filter(s => !s.skipFor || !s.skipFor.includes(state.pageType || ''))
            const currentVisibleIndex = visibleSteps.findIndex(s => s.key === currentStep)
            const currentLabel = ALL_STEP_LABELS.find(s => s.key === currentStep)?.label || ''
            return (
              <>
                <div className="flex items-center gap-1.5 justify-center">
                  {visibleSteps.map((step, i) => (
                    <div key={step.key} className="flex items-center gap-1.5">
                      <div className={[
                        'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors',
                        step.key <= currentStep
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      ].join(' ')}>
                        {i + 1}
                      </div>
                      {i < visibleSteps.length - 1 && (
                        <div className={[
                          'w-3 h-0.5 transition-colors',
                          step.key < currentStep ? 'bg-primary' : 'bg-muted',
                        ].join(' ')} />
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-center text-xs text-muted-foreground mt-1">
                  Step {Math.max(currentVisibleIndex + 1, 1)}: {currentLabel}
                </p>
              </>
            )
          })()}
        </div>

        {currentStep > 0 && (
          <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 opacity-60">
            <RotateCcw className="size-3.5" />
            Start Over
          </Button>
        )}
        {currentStep === 0 && <div className="w-[100px]" />}
      </div>

      {/* Step Content */}
      <div ref={contentRef} className="flex-1 overflow-auto">
        {renderStep()}
      </div>
    </div>
  )
}
