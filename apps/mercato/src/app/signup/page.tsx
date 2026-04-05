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
    margin: '0 0 24px',
    textAlign: 'center' as const,
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
    marginTop: '4px',
  } as React.CSSProperties,
  buttonDisabled: {
    opacity: 0.7,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  error: {
    color: '#dc2626',
    fontSize: '14px',
    textAlign: 'center' as const,
    marginBottom: '16px',
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
}

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (data.ok) {
        window.location.href = data.redirect || '/backend'
      } else {
        setError(data.error || 'Failed to create account')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
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
        <h1 style={styles.heading}>Create your account</h1>

        {error && <p style={styles.error}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Full name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setFocusedField('name')}
            onBlur={() => setFocusedField(null)}
            style={inputStyle('name')}
            placeholder="John Doe"
          />

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

          <label style={styles.label}>Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField(null)}
            style={inputStyle('password')}
            placeholder="Min. 8 characters"
          />

          <button
            type="submit"
            disabled={loading}
            style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <div style={styles.bottomRow}>
          Already have an account?{' '}
          <a href="/login" style={styles.link}>Sign in</a>
        </div>
      </div>
    </div>
  )
}
