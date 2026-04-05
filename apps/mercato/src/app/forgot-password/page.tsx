'use client'

import { useState, FormEvent } from 'react'

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #ffffff 0%, #f0f0f5 100%)',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: '20px',
  } as React.CSSProperties,
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08)',
    padding: '40px 36px',
  } as React.CSSProperties,
  logoWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginBottom: '32px',
  } as React.CSSProperties,
  logo: {
    height: '32px',
    marginBottom: '10px',
    display: 'block',
  } as React.CSSProperties,
  brand: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#111',
    margin: 0,
    letterSpacing: '-0.5px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  } as React.CSSProperties,
  heading: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#111',
    margin: '0 0 8px',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  subtitle: {
    fontSize: '14px',
    color: '#666',
    textAlign: 'center' as const,
    margin: '0 0 24px',
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    marginBottom: '6px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxSizing: 'border-box' as const,
    marginBottom: '16px',
  } as React.CSSProperties,
  inputFocus: {
    borderColor: '#0000CC',
    boxShadow: '0 0 0 3px rgba(0, 0, 204, 0.1)',
  } as React.CSSProperties,
  button: {
    width: '100%',
    padding: '12px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#fff',
    background: '#0000CC',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as React.CSSProperties,
  buttonDisabled: {
    opacity: 0.7,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  link: {
    color: '#0000CC',
    textDecoration: 'none',
    fontWeight: 500,
  } as React.CSSProperties,
  bottomRow: {
    textAlign: 'center' as const,
    marginTop: '24px',
    fontSize: '14px',
    color: '#666',
  } as React.CSSProperties,
  success: {
    textAlign: 'center' as const,
    padding: '20px 0',
  } as React.CSSProperties,
  successIcon: {
    fontSize: '48px',
    marginBottom: '16px',
    color: '#16a34a',
  } as React.CSSProperties,
  successText: {
    fontSize: '16px',
    color: '#333',
    marginBottom: '8px',
  } as React.CSSProperties,
  successSub: {
    fontSize: '14px',
    color: '#666',
  } as React.CSSProperties,
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // Ignore errors — always show success to avoid revealing account existence
    }

    setSuccess(true)
    setLoading(false)
  }

  function inputStyle(field: string) {
    return focusedField === field
      ? { ...styles.input, ...styles.inputFocus }
      : styles.input
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <img src="/launchos-logo.png" alt="LaunchOS" style={styles.logo} />
          <p style={styles.brand}>LaunchOS</p>
        </div>

        {success ? (
          <div style={styles.success}>
            <div style={styles.successIcon}>&#10003;</div>
            <p style={styles.successText}>Check your email</p>
            <p style={styles.successSub}>
              If an account exists for <strong>{email}</strong>, we&apos;ve sent a password reset link.
            </p>
            <div style={{ ...styles.bottomRow, marginTop: '32px' }}>
              <a href="/login" style={styles.link}>Back to sign in</a>
            </div>
          </div>
        ) : (
          <>
            <h1 style={styles.heading}>Reset your password</h1>
            <p style={styles.subtitle}>
              Enter your email and we&apos;ll send you a reset link.
            </p>

            <form onSubmit={handleSubmit}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                style={inputStyle('email')}
                placeholder="you@example.com"
              />

              <button
                type="submit"
                disabled={loading}
                style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>

            <div style={styles.bottomRow}>
              <a href="/login" style={styles.link}>Back to sign in</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
