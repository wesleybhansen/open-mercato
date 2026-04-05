export const TEMPLATE_CSS_DARK = `
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #06060A; --bg-raised: #0C0C12; --bg-card: #11111A; --surface: #16161F;
  --white: #EDEDEF; --warm-bg: #0C0C12; --warm-bg-dark: #06060A;
  --text: #EDEDEF; --text-secondary: #8A8A9A; --text-muted: #5A5A6A; --border: rgba(255,255,255,0.08);
  --tomato: #8B5CF6; --tomato-hover: #7C3AED; --tomato-bg: rgba(139,92,246,0.12);
  --orange: #A78BFA; --orange-bg: rgba(167,139,250,0.1); --blue: #6366F1; --blue-bg: rgba(99,102,241,0.1);
  --green: #34D399; --green-bg: rgba(52,211,153,0.1); --purple: #8B5CF6; --purple-bg: rgba(139,92,246,0.1);
  --yellow: #FBBF24; --yellow-bg: rgba(251,191,36,0.1);
  --shadow: 0 2px 8px rgba(0,0,0,0.3); --shadow-hover: 0 8px 24px rgba(0,0,0,0.4);
  --font: 'Instrument Sans', -apple-system, sans-serif;
  --container: 720px; --radius: 10px; --radius-lg: 16px; --radius-pill: 100px; --transition: 0.3s cubic-bezier(0.4,0,0.2,1);
}
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
body { font-family: var(--font); background: var(--bg); color: var(--text); font-size: 16px; line-height: 1.65; }
.container { max-width: var(--container); margin: 0 auto; padding: 0 24px; }
a { color: var(--tomato); text-decoration: none; }

/* Nav */
.nav { padding: 18px 0; border-bottom: 1px solid var(--border); background: rgba(6,6,10,0.85); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 50; }
.nav .container { max-width: 920px; }
.nav-inner { display: flex; align-items: center; justify-content: space-between; }
.nav-logo { font-weight: 700; font-size: 17px; color: var(--text); letter-spacing: -0.02em; }
.nav-links { display: flex; gap: 28px; list-style: none; }
.nav-links a { font-size: 14px; color: var(--text-secondary); font-weight: 500; transition: color var(--transition); }
.nav-links a:hover { color: var(--text); }
.nav-cta { font-size: 13px; font-weight: 600; padding: 8px 20px; background: var(--tomato); color: #fff; border-radius: var(--radius-pill); transition: all var(--transition); }
.nav-cta:hover { background: var(--tomato-hover); box-shadow: 0 0 20px rgba(139,92,246,0.3); }
.nav-mobile-toggle { display: none; }
.mobile-nav { display: none; }

/* Hero */
.hero { padding: 140px 0 120px; text-align: center; min-height: 90vh; display: flex; align-items: center; }
.hero .container { max-width: 1100px; }
.hero h1 { font-size: 56px; font-weight: 700; letter-spacing: -0.04em; line-height: 1.1; margin: 0 auto 24px; }
.hero-desc { font-size: 18px; color: var(--text-secondary); line-height: 1.7; max-width: 500px; margin: 0 auto 36px; }
.hero-buttons { display: flex; gap: 12px; justify-content: center; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: var(--radius-pill); font-size: 15px; font-weight: 600; font-family: var(--font); transition: all var(--transition); text-decoration: none; border: none; cursor: pointer; }
.btn svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none; }
.btn-tomato { background: var(--tomato); color: #fff; box-shadow: 0 0 24px rgba(139,92,246,0.25); }
.btn-tomato:hover { background: var(--tomato-hover); box-shadow: 0 0 32px rgba(139,92,246,0.4); transform: translateY(-1px); }
.btn-outline { background: transparent; color: var(--text); border: 1.5px solid var(--border); }
.btn-outline:hover { border-color: var(--text-secondary); }
.tag { display: inline-block; padding: 4px 12px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.tag-tomato { background: var(--tomato-bg); color: var(--tomato); }
.tag-orange { background: var(--orange-bg); color: var(--orange); }
.tag-blue { background: var(--blue-bg); color: var(--blue); }
.tag-green { background: var(--green-bg); color: var(--green); }
.tag-purple { background: var(--purple-bg); color: var(--purple); }
.tag-yellow { background: var(--yellow-bg); color: var(--yellow); }
.hero-social-proof { display: flex; align-items: center; gap: 10px; }
.hero-social-text { font-size: 14px; color: var(--text-secondary); }

/* Learn */
.learn { padding: 80px 0; }
.learn .container { max-width: 920px; }
.learn-header { text-align: center; margin-bottom: 48px; }
.learn-header h2 { font-size: 36px; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 8px; }
.learn-header p { color: var(--text-secondary); }
.learn-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.learn-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; transition: border-color var(--transition); }
.learn-card:hover { border-color: rgba(139,92,246,0.2); }
.learn-card .tag { margin-bottom: 14px; }
.learn-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 8px; line-height: 1.35; }
.learn-card p { font-size: 14px; color: var(--text-secondary); line-height: 1.6; }

/* Highlights */
.highlights { padding: 64px 0; background: var(--bg-raised); }
.highlights .container { max-width: 920px; }
.highlights-header { text-align: center; margin-bottom: 40px; }
.highlights-header h2 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; }
.highlights-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.highlight-card { display: flex; gap: 16px; padding: 24px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); transition: border-color var(--transition); }
.highlight-card:hover { border-color: rgba(139,92,246,0.2); }
.highlight-accent { display: none; }
.highlight-icon svg { width: 20px; height: 20px; stroke: var(--tomato); stroke-width: 1.5; fill: none; }
.highlight-body h3 { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.highlight-body p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }

/* Curriculum */
.curriculum { padding: 80px 0; }
.curriculum .container { max-width: 720px; }
.curriculum-header { text-align: center; margin-bottom: 40px; }
.curriculum-header h2 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; }
.curriculum-header p { font-size: 14px; color: var(--text-secondary); }
.module-item { border-bottom: 1px solid var(--border); }
.module-header { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 18px 0; border: none; background: none; cursor: pointer; font-family: var(--font); color: var(--text); }
.module-header-left { display: flex; align-items: center; gap: 10px; }
.module-chevron svg { width: 16px; height: 16px; stroke: var(--text-muted); stroke-width: 2; fill: none; transition: transform 0.2s; }
.module-item.active .module-chevron svg { transform: rotate(90deg); }
.module-title { font-size: 15px; font-weight: 600; }
.module-meta { font-size: 12px; color: var(--text-muted); }
.module-lessons { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.module-item.active .module-lessons { max-height: 600px; }
.module-lessons-inner { padding: 0 0 16px 26px; }
.lesson-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 14px; color: var(--text-secondary); }
.lesson-check svg { width: 14px; height: 14px; stroke: var(--text-muted); stroke-width: 2; fill: none; }
.free-tag { font-size: 11px; color: var(--green); font-weight: 600; margin-left: auto; }

/* Who */
.who-section { padding: 64px 0; background: var(--bg-raised); }
.who-section .container { max-width: 920px; }
.who-header { text-align: center; margin-bottom: 40px; }
.who-header h2 { font-size: 32px; font-weight: 700; }
.who-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.who-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 32px 28px; text-align: center; transition: border-color var(--transition); }
.who-card:hover { border-color: rgba(139,92,246,0.2); }
.who-icon { width: 40px; height: 40px; margin: 0 auto 14px; background: rgba(139,92,246,0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.who-icon svg { width: 20px; height: 20px; stroke: var(--tomato); stroke-width: 1.5; fill: none; }
.who-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
.who-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.65; }

/* Instructor */
.instructor { padding: 64px 0; }
.instructor .container { max-width: 720px; }
.instructor-grid { display: flex; gap: 24px; align-items: center; }
.instructor-avatar { width: 64px; height: 64px; background: linear-gradient(135deg, var(--tomato), var(--blue)); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; flex-shrink: 0; }
.instructor-name { font-size: 18px; font-weight: 700; }
.instructor-title { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
.instructor-bio { font-size: 14px; color: var(--text-secondary); line-height: 1.65; }

/* FAQ */
.faq { padding: 80px 0; background: var(--bg-raised); }
.faq .container { max-width: 720px; }
.faq-header { text-align: center; margin-bottom: 40px; }
.faq-header h2 { font-size: 32px; font-weight: 700; }
.faq-item { border-bottom: 1px solid var(--border); }
.faq-question { display: flex; align-items: center; gap: 10px; width: 100%; padding: 18px 0; border: none; background: none; cursor: pointer; font-family: var(--font); font-size: 15px; font-weight: 600; color: var(--text); text-align: left; }
.faq-chevron svg { width: 16px; height: 16px; stroke: var(--text-muted); stroke-width: 2; fill: none; transition: transform 0.2s; }
.faq-item.active .faq-chevron svg { transform: rotate(90deg); }
.faq-answer { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.faq-item.active .faq-answer { max-height: 300px; }
.faq-answer-inner { padding: 0 0 18px 26px; }
.faq-answer-inner p { font-size: 14px; color: var(--text-secondary); line-height: 1.65; }

/* Pricing */
.pricing-section { padding: 80px 0; }
.pricing-section .container { max-width: 480px; }
.pricing-header { text-align: center; margin-bottom: 40px; }
.pricing-header h2 { font-size: 32px; font-weight: 700; }
.pricing-header p { color: var(--text-secondary); }
.enroll-card { background: var(--bg-card); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 40px; }
.enroll-card.featured { border-color: var(--tomato); box-shadow: 0 0 40px rgba(139,92,246,0.15); }
.enroll-card .pricing-price { font-size: 48px; font-weight: 800; text-align: center; letter-spacing: -1.5px; margin-bottom: 6px; }
.enroll-card .pricing-desc { font-size: 14px; color: var(--text-muted); text-align: center; margin-bottom: 28px; }
.enroll-card .pricing-features { list-style: none; margin-bottom: 28px; }
.enroll-card .pricing-features li { display: flex; align-items: center; gap: 12px; font-size: 15px; color: var(--text-secondary); padding: 8px 0; }
.enroll-card .pricing-features li svg { width: 16px; height: 16px; stroke: var(--green); stroke-width: 2.5; fill: none; flex-shrink: 0; }
.enroll-form .field { margin-bottom: 14px; }
.enroll-form .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text); }
.enroll-form .field input, .enroll-form .field select, .enroll-form .field textarea { width: 100%; padding: 12px 14px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 15px; font-family: var(--font); background: var(--surface); color: var(--text); outline: none; transition: border-color var(--transition); box-sizing: border-box; }
.enroll-form .field input:focus, .enroll-form .field select:focus, .enroll-form .field textarea:focus { border-color: var(--tomato); }
.enroll-form .field input::placeholder, .enroll-form .field textarea::placeholder { color: var(--text-muted); }
.enroll-form .field select option { background: var(--bg-card); color: var(--text); }
.enroll-form .field textarea { resize: vertical; min-height: 80px; }
.enroll-form .options { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.enroll-form .check-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-secondary); cursor: pointer; padding: 8px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); transition: border-color var(--transition); }
.enroll-form .check-label:hover { border-color: var(--text-muted); }
.enroll-form .check-label input { width: auto; margin: 0; accent-color: var(--tomato); }
.enroll-btn { display: block; width: 100%; padding: 14px; background: var(--tomato); color: #fff; border: none; border-radius: var(--radius-pill); font-size: 16px; font-weight: 700; cursor: pointer; font-family: var(--font); transition: all var(--transition); margin-top: 8px; }
.enroll-btn:hover { background: var(--tomato-hover); box-shadow: 0 0 24px rgba(139,92,246,0.3); }
.enroll-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.error { background: rgba(239,68,68,0.1); color: #FCA5A5; padding: 10px 14px; border-radius: var(--radius); font-size: 13px; margin-bottom: 14px; display: none; }
.success { text-align: center; padding: 24px 0; }
.success h3 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
.success p { color: var(--text-secondary); font-size: 14px; }
.terms-check { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-secondary); cursor: pointer; padding: 14px 0 10px; }
.terms-box { background: var(--surface); border-radius: var(--radius); padding: 14px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; max-height: 160px; overflow-y: auto; margin: 8px 0 12px; display: none; }
.guarantee { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; font-size: 13px; color: var(--text-muted); }
.guarantee svg { width: 16px; height: 16px; stroke: var(--text-muted); stroke-width: 1.5; fill: none; }

/* Footer */
.footer { padding: 40px 0; border-top: 1px solid var(--border); }
.footer-bottom { text-align: center; font-size: 13px; color: var(--text-muted); }

/* Animations */
.reveal { opacity: 0; transform: translateY(16px); transition: opacity 0.5s ease, transform 0.5s ease; }
.reveal.visible { opacity: 1; transform: none; }

/* Mobile */
@media (max-width: 768px) {
  .nav-links { display: none; }
  .nav-cta { display: none; }
  .nav-mobile-toggle { display: flex; align-items: center; justify-content: center; background: none; border: 1px solid var(--border); border-radius: var(--radius); width: 36px; height: 36px; cursor: pointer; }
  .nav-mobile-toggle svg { width: 18px; height: 18px; stroke: var(--text); stroke-width: 2; fill: none; }
  .mobile-nav { position: fixed; top: 0; left: 0; right: 0; background: var(--bg); z-index: 100; padding: 20px 24px; display: none; flex-direction: column; gap: 16px; border-bottom: 1px solid var(--border); }
  .mobile-nav.open { display: flex; }
  .mobile-nav a { font-size: 16px; font-weight: 500; color: var(--text); }
  .hero h1 { font-size: 36px; }
  .learn-grid, .highlights-grid, .who-grid { grid-template-columns: 1fr !important; }
}
`;
