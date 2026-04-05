'use client'

import { useReducer, useEffect, useCallback } from 'react'
import type { WizardState, PageType, SubType, Framework, SectionType, GeneratedSection, StyleId, ToneId, BusinessContext, LeadMagnetConfig } from '../types'
import { DEFAULT_FORM_FIELDS } from '../constants'
import { resolveFramework } from '../framework-resolver'

const STORAGE_KEY = 'lp-wizard-state'

const initialState: WizardState = {
  step: 0,
  pageType: null,
  subType: null,
  framework: null,
  sections: [],
  businessContext: {
    businessName: '',
    targetAudience: '',
    tone: 'professional',
    customTone: '',
    offerAnswers: {},
  },
  generatedSections: [],
  styleId: null,
  styleVariant: 0,
  slug: '',
  formFields: [],
  metaTitle: '',
  metaDescription: '',
  thankYouHeadline: '',
  thankYouMessage: '',
  pipelineStage: null,
  bookingPageSlug: null,
  leadMagnet: null,
  linkedFormId: null,
  productId: null,
  heroImageUrl: null,
  simpleLayout: false,
}

type Action =
  | { type: 'SET_STEP'; step: number }
  | { type: 'SET_PAGE_TYPE'; pageType: PageType }
  | { type: 'SET_SUB_TYPE'; subType: SubType }
  | { type: 'SET_BUSINESS_CONTEXT'; data: Partial<BusinessContext> }
  | { type: 'SET_OFFER_ANSWER'; key: string; value: string }
  | { type: 'SET_GENERATED_COPY'; sections: GeneratedSection[]; metaTitle: string; metaDescription: string; thankYouHeadline: string; thankYouMessage: string }
  | { type: 'UPDATE_SECTION'; index: number; section: GeneratedSection }
  | { type: 'REMOVE_SECTION'; index: number }
  | { type: 'REORDER_SECTIONS'; fromIndex: number; toIndex: number }
  | { type: 'SELECT_HEADLINE_VARIANT'; sectionIndex: number; variantIndex: number }
  | { type: 'SELECT_CTA_VARIANT'; sectionIndex: number; variantIndex: number }
  | { type: 'SET_STYLE'; styleId: StyleId }
  | { type: 'SET_STYLE_VARIANT'; variant: number }
  | { type: 'SET_SLUG'; slug: string }
  | { type: 'SET_PIPELINE_STAGE'; stage: string }
  | { type: 'SET_BOOKING_PAGE'; bookingPageSlug: string }
  | { type: 'SET_LEAD_MAGNET'; leadMagnet: LeadMagnetConfig | null }
  | { type: 'SET_PRODUCT'; productId: string }
  | { type: 'SET_HERO_IMAGE'; url: string }
  | { type: 'SET_SIMPLE_LAYOUT'; simple: boolean }
  | { type: 'SET_THANK_YOU'; headline: string; message: string }
  | { type: 'RESET' }

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step }

    case 'SET_PAGE_TYPE': {
      const formFields = DEFAULT_FORM_FIELDS[action.pageType] || DEFAULT_FORM_FIELDS.general
      return {
        ...state,
        pageType: action.pageType,
        subType: null,
        framework: null,
        sections: [],
        generatedSections: [],
        formFields,
        step: 1,
      }
    }

    case 'SET_SUB_TYPE': {
      const price = state.businessContext.offerAnswers.price
      const resolved = resolveFramework(state.pageType!, action.subType, price)
      return {
        ...state,
        subType: action.subType,
        framework: resolved.framework,
        sections: resolved.sections,
        step: 2,
      }
    }

    case 'SET_BUSINESS_CONTEXT':
      return {
        ...state,
        businessContext: { ...state.businessContext, ...action.data },
      }

    case 'SET_OFFER_ANSWER':
      return {
        ...state,
        businessContext: {
          ...state.businessContext,
          offerAnswers: { ...state.businessContext.offerAnswers, [action.key]: action.value },
        },
      }

    case 'SET_GENERATED_COPY':
      return {
        ...state,
        generatedSections: action.sections,
        metaTitle: action.metaTitle,
        metaDescription: action.metaDescription,
        thankYouHeadline: action.thankYouHeadline,
        thankYouMessage: action.thankYouMessage,
      }

    case 'UPDATE_SECTION': {
      const sections = [...state.generatedSections]
      sections[action.index] = action.section
      return { ...state, generatedSections: sections }
    }

    case 'REMOVE_SECTION': {
      const sections = state.generatedSections.filter((_, i) => i !== action.index)
      return { ...state, generatedSections: sections }
    }

    case 'REORDER_SECTIONS': {
      const sections = [...state.generatedSections]
      const [moved] = sections.splice(action.fromIndex, 1)
      sections.splice(action.toIndex, 0, moved)
      return { ...state, generatedSections: sections }
    }

    case 'SELECT_HEADLINE_VARIANT': {
      const sections = [...state.generatedSections]
      const section = { ...sections[action.sectionIndex] }
      if (section.headlineVariants) {
        section.selectedHeadline = action.variantIndex
        section.headline = section.headlineVariants[action.variantIndex]
      }
      sections[action.sectionIndex] = section
      return { ...state, generatedSections: sections }
    }

    case 'SELECT_CTA_VARIANT': {
      const sections = [...state.generatedSections]
      const section = { ...sections[action.sectionIndex] }
      if (section.ctaVariants) {
        section.selectedCta = action.variantIndex
        section.ctaText = section.ctaVariants[action.variantIndex]
      }
      sections[action.sectionIndex] = section
      return { ...state, generatedSections: sections }
    }

    case 'SET_STYLE':
      return { ...state, styleId: action.styleId }

    case 'SET_STYLE_VARIANT':
      return { ...state, styleVariant: action.variant }

    case 'SET_SLUG':
      return { ...state, slug: action.slug }

    case 'SET_PIPELINE_STAGE':
      return { ...state, pipelineStage: action.stage }

    case 'SET_BOOKING_PAGE':
      return { ...state, bookingPageSlug: action.bookingPageSlug }

    case 'SET_LEAD_MAGNET':
      return { ...state, leadMagnet: action.leadMagnet }

    case 'SET_PRODUCT':
      return { ...state, productId: action.productId }

    case 'SET_HERO_IMAGE':
      return { ...state, heroImageUrl: action.url }

    case 'SET_SIMPLE_LAYOUT':
      return { ...state, simpleLayout: action.simple }

    case 'SET_THANK_YOU':
      return { ...state, thankYouHeadline: action.headline, thankYouMessage: action.message }

    case 'RESET':
      return { ...initialState }

    default:
      return state
  }
}

export function useWizardState() {
  const [state, dispatch] = useReducer(reducer, initialState, () => {
    if (typeof window === 'undefined') return initialState
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Only restore if the saved state has meaningful progress (past step 1)
        if (parsed.step >= 2 && parsed.pageType) {
          return { ...initialState, ...parsed }
        }
      }
    } catch {}
    return initialState
  })

  // Persist state to sessionStorage on every change (debounced by React batching)
  useEffect(() => {
    if (state.step >= 2 && state.pageType) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {}
    }
  }, [state])

  const goToStep = useCallback((step: number) => dispatch({ type: 'SET_STEP', step }), [])
  const nextStep = useCallback(() => dispatch({ type: 'SET_STEP', step: state.step + 1 }), [state.step])
  const prevStep = useCallback(() => dispatch({ type: 'SET_STEP', step: Math.max(0, state.step - 1) }), [state.step])

  const setPageType = useCallback((pageType: PageType) => dispatch({ type: 'SET_PAGE_TYPE', pageType }), [])
  const setSubType = useCallback((subType: SubType) => dispatch({ type: 'SET_SUB_TYPE', subType }), [])

  const setBusinessContext = useCallback((data: Partial<BusinessContext>) => dispatch({ type: 'SET_BUSINESS_CONTEXT', data }), [])
  const setOfferAnswer = useCallback((key: string, value: string) => dispatch({ type: 'SET_OFFER_ANSWER', key, value }), [])

  const setGeneratedCopy = useCallback((sections: GeneratedSection[], metaTitle: string, metaDescription: string, thankYouHeadline: string, thankYouMessage: string) =>
    dispatch({ type: 'SET_GENERATED_COPY', sections, metaTitle, metaDescription, thankYouHeadline, thankYouMessage }), [])
  const updateSection = useCallback((index: number, section: GeneratedSection) =>
    dispatch({ type: 'UPDATE_SECTION', index, section }), [])
  const removeSection = useCallback((index: number) => dispatch({ type: 'REMOVE_SECTION', index }), [])
  const reorderSections = useCallback((fromIndex: number, toIndex: number) =>
    dispatch({ type: 'REORDER_SECTIONS', fromIndex, toIndex }), [])
  const selectHeadlineVariant = useCallback((sectionIndex: number, variantIndex: number) =>
    dispatch({ type: 'SELECT_HEADLINE_VARIANT', sectionIndex, variantIndex }), [])
  const selectCtaVariant = useCallback((sectionIndex: number, variantIndex: number) =>
    dispatch({ type: 'SELECT_CTA_VARIANT', sectionIndex, variantIndex }), [])

  const setStyle = useCallback((styleId: StyleId) => dispatch({ type: 'SET_STYLE', styleId }), [])
  const setStyleVariant = useCallback((variant: number) => dispatch({ type: 'SET_STYLE_VARIANT', variant }), [])
  const setSlug = useCallback((slug: string) => dispatch({ type: 'SET_SLUG', slug }), [])
  const setPipelineStage = useCallback((stage: string) => dispatch({ type: 'SET_PIPELINE_STAGE', stage }), [])
  const setBookingPage = useCallback((bookingPageSlug: string) => dispatch({ type: 'SET_BOOKING_PAGE', bookingPageSlug }), [])
  const setLeadMagnet = useCallback((leadMagnet: LeadMagnetConfig | null) => dispatch({ type: 'SET_LEAD_MAGNET', leadMagnet }), [])
  const setProduct = useCallback((productId: string) => dispatch({ type: 'SET_PRODUCT', productId }), [])
  const setHeroImage = useCallback((url: string) => dispatch({ type: 'SET_HERO_IMAGE', url }), [])
  const setSimpleLayout = useCallback((simple: boolean) => dispatch({ type: 'SET_SIMPLE_LAYOUT', simple }), [])
  const setThankYou = useCallback((headline: string, message: string) => dispatch({ type: 'SET_THANK_YOU', headline, message }), [])

  const reset = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    dispatch({ type: 'RESET' })
  }, [])

  // Recompute framework when price changes in offer answers
  const updateFrameworkFromPrice = useCallback(() => {
    if (state.pageType && state.subType) {
      const price = state.businessContext.offerAnswers.price
      const resolved = resolveFramework(state.pageType, state.subType, price)
      if (resolved.framework !== state.framework) {
        dispatch({ type: 'SET_SUB_TYPE', subType: state.subType })
      }
    }
  }, [state.pageType, state.subType, state.framework, state.businessContext.offerAnswers.price])

  return {
    state,
    goToStep,
    nextStep,
    prevStep,
    setPageType,
    setSubType,
    setBusinessContext,
    setOfferAnswer,
    setGeneratedCopy,
    updateSection,
    removeSection,
    reorderSections,
    selectHeadlineVariant,
    selectCtaVariant,
    setStyle,
    setStyleVariant,
    setSlug,
    setPipelineStage,
    setBookingPage,
    setLeadMagnet,
    setProduct,
    setHeroImage,
    setSimpleLayout,
    setThankYou,
    reset,
    updateFrameworkFromPrice,
  }
}

export type WizardActions = ReturnType<typeof useWizardState>
