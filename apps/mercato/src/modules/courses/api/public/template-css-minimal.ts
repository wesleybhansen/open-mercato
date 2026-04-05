export const TEMPLATE_CSS_MINIMAL = `
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --white: #FFFFFF; --snow: #FAFAFA; --warm-bg: #FAFAFA; --warm-bg-dark: #F0F0F0;
  --text: #1A1A1A; --text-secondary: #757575; --text-muted: #999999; --border: #E0E0E0;
  --tomato: #1A1A1A; --tomato-hover: #333333; --tomato-bg: rgba(26,26,26,0.06);
  --orange: #1A1A1A; --orange-bg: rgba(26,26,26,0.04); --blue: #1A1A1A; --blue-bg: rgba(26,26,26,0.04);
  --green: #6B7F5E; --green-bg: rgba(107,127,94,0.08); --purple: #1A1A1A; --purple-bg: rgba(26,26,26,0.04);
  --yellow: #1A1A1A; --yellow-bg: rgba(26,26,26,0.04);
  --shadow: 0 1px 2px rgba(0,0,0,0.04); --shadow-hover: 0 2px 8px rgba(0,0,0,0.06);
  --font: 'Manrope', -apple-system, sans-serif; --font-serif: 'Literata', Georgia, serif;
  --container: 680px; --radius: 6px; --radius-lg: 10px; --radius-pill: 100px; --transition: 0.2s ease;
}
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
body { font-family: var(--font); background: var(--white); color: var(--text); font-size: 16px; line-height: 1.7; }
.container { max-width: var(--container); margin: 0 auto; padding: 0 24px; }
a { color: var(--text); text-decoration: none; }

/* Nav */
.nav { padding: 20px 0; border-bottom: 1px solid var(--border); background: var(--white); position: sticky; top: 0; z-index: 50; }
.nav .container { max-width: 920px; }
.nav-inner { display: flex; align-items: center; justify-content: space-between; }
.nav-logo { font-family: var(--font-serif); font-weight: 600; font-size: 18px; letter-spacing: -0.02em; }
.nav-links { display: flex; gap: 28px; list-style: none; }
.nav-links a { font-size: 14px; color: var(--text-secondary); font-weight: 500; transition: color var(--transition); }
.nav-links a:hover { color: var(--text); }
.nav-cta { font-size: 13px; font-weight: 600; padding: 8px 20px; background: var(--text); color: var(--white); border-radius: var(--radius-pill); transition: background var(--transition); }
.nav-cta:hover { background: var(--tomato-hover); }
.nav-mobile-toggle { display: none; }
.mobile-nav { display: none; }

/* Hero */
.hero { padding: 140px 0 120px; text-align: center; min-height: 90vh; display: flex; align-items: center; }
.hero .container { max-width: 1100px; }
.hero h1 { font-family: var(--font-serif); font-size: 48px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.15; margin: 0 auto 20px; }
.hero-desc { font-size: 18px; color: var(--text-secondary); line-height: 1.7; max-width: 480px; margin: 0 auto 32px; }
.hero-buttons { display: flex; gap: 12px; justify-content: center; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: var(--radius-pill); font-size: 15px; font-weight: 600; font-family: var(--font); transition: all var(--transition); text-decoration: none; border: none; cursor: pointer; }
.btn svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none; }
.btn-tomato { background: var(--text); color: var(--white); }
.btn-tomato:hover { background: var(--tomato-hover); }
.btn-outline { background: transparent; color: var(--text); border: 1.5px solid var(--border); }
.btn-outline:hover { border-color: var(--text); }
.tag { display: inline-block; padding: 4px 12px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.tag-tomato { background: var(--tomato-bg); color: var(--text); }
.tag-orange,.tag-blue,.tag-green,.tag-purple,.tag-yellow { background: rgba(26,26,26,0.05); color: var(--text-secondary); }
.hero-social-proof { display: flex; align-items: center; gap: 10px; }
.hero-social-text { font-size: 14px; color: var(--text-secondary); }

/* Learn */
.learn { padding: 80px 0; }
.learn .container { max-width: 920px; }
.learn-header { text-align: center; margin-bottom: 48px; }
.learn-header h2 { font-family: var(--font-serif); font-size: 36px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 8px; }
.learn-header p { color: var(--text-secondary); font-size: 16px; }
.learn-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.learn-card { background: var(--white); padding: 32px; }
.learn-card .tag { margin-bottom: 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.learn-card h3 { font-size: 17px; font-weight: 700; margin-bottom: 8px; line-height: 1.35; }
.learn-card p { font-size: 14px; color: var(--text-secondary); line-height: 1.65; }

/* Highlights */
.highlights { padding: 64px 0; background: var(--snow); }
.highlights .container { max-width: 920px; }
.highlights-header { text-align: center; margin-bottom: 40px; }
.highlights-header h2 { font-family: var(--font-serif); font-size: 32px; font-weight: 600; letter-spacing: -0.02em; }
.highlights-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
.highlight-card { display: flex; gap: 16px; padding: 24px; background: var(--white); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.highlight-accent { display: none; }
.highlight-icon svg { width: 20px; height: 20px; stroke: var(--text-secondary); stroke-width: 1.5; fill: none; }
.highlight-body h3 { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.highlight-body p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }

/* Curriculum */
.curriculum { padding: 80px 0; }
.curriculum .container { max-width: 680px; }
.curriculum-header { text-align: center; margin-bottom: 40px; }
.curriculum-header h2 { font-family: var(--font-serif); font-size: 32px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 6px; }
.curriculum-header p { font-size: 14px; color: var(--text-secondary); }
.module-item { border-bottom: 1px solid var(--border); }
.module-header { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 18px 0; border: none; background: none; cursor: pointer; font-family: var(--font); }
.module-header-left { display: flex; align-items: center; gap: 10px; }
.module-chevron svg { width: 16px; height: 16px; stroke: var(--text-muted); stroke-width: 2; fill: none; transition: transform 0.2s; }
.module-item.active .module-chevron svg { transform: rotate(90deg); }
.module-title { font-size: 15px; font-weight: 600; color: var(--text); }
.module-meta { font-size: 12px; color: var(--text-muted); }
.module-lessons { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.module-item.active .module-lessons { max-height: 600px; }
.module-lessons-inner { padding: 0 0 16px 26px; }
.lesson-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 14px; color: var(--text-secondary); }
.lesson-check svg { width: 14px; height: 14px; stroke: var(--border); stroke-width: 2; fill: none; }
.free-tag { font-size: 11px; color: var(--green); font-weight: 600; margin-left: auto; }

/* Who */
.who-section { padding: 64px 0; background: var(--snow); }
.who-section .container { max-width: 680px; }
.who-header { text-align: center; margin-bottom: 32px; }
.who-header h2 { font-family: var(--font-serif); font-size: 32px; font-weight: 600; }
.who-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.who-card { padding: 32px 28px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--white); text-align: center; }
.who-icon { width: 40px; height: 40px; margin: 0 auto 14px; background: var(--snow); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.who-icon svg { width: 20px; height: 20px; stroke: var(--text); stroke-width: 1.5; fill: none; }
.who-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
.who-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.65; }

/* Instructor */
.instructor { padding: 64px 0; }
.instructor .container { max-width: 680px; }
.instructor-grid { display: flex; gap: 24px; align-items: center; }
.instructor-avatar { width: 64px; height: 64px; background: var(--text); color: var(--white); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; flex-shrink: 0; }
.instructor-name { font-size: 18px; font-weight: 700; }
.instructor-title { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
.instructor-bio { font-size: 14px; color: var(--text-secondary); line-height: 1.65; }

/* FAQ */
.faq { padding: 80px 0; background: var(--snow); }
.faq .container { max-width: 680px; }
.faq-header { text-align: center; margin-bottom: 40px; }
.faq-header h2 { font-family: var(--font-serif); font-size: 32px; font-weight: 600; }
.faq-list { }
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
.pricing-header h2 { font-family: var(--font-serif); font-size: 32px; font-weight: 600; }
.pricing-header p { color: var(--text-secondary); }
.enroll-card { background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 40px; }
.enroll-card.featured { border-color: var(--text); }
.enroll-card .pricing-price { font-size: 48px; font-weight: 800; text-align: center; letter-spacing: -1.5px; margin-bottom: 6px; }
.enroll-card .pricing-desc { font-size: 14px; color: var(--text-muted); text-align: center; margin-bottom: 28px; }
.enroll-card .pricing-features { list-style: none; margin-bottom: 28px; }
.enroll-card .pricing-features li { display: flex; align-items: center; gap: 12px; font-size: 15px; color: var(--text-secondary); padding: 8px 0; }
.enroll-card .pricing-features li svg { width: 16px; height: 16px; stroke: var(--green); stroke-width: 2.5; fill: none; flex-shrink: 0; }
.enroll-form .field { margin-bottom: 14px; }
.enroll-form .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.enroll-form .field input, .enroll-form .field select, .enroll-form .field textarea { width: 100%; padding: 12px 14px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 15px; font-family: var(--font); background: var(--white); outline: none; transition: border-color var(--transition); box-sizing: border-box; }
.enroll-form .field input:focus, .enroll-form .field select:focus, .enroll-form .field textarea:focus { border-color: var(--text); }
.enroll-form .field input::placeholder, .enroll-form .field textarea::placeholder { color: var(--text-muted); }
.enroll-form .field select option { background: var(--white); color: var(--text); }
.enroll-form .field textarea { resize: vertical; min-height: 80px; }
.enroll-form .options { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.enroll-form .check-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-secondary); cursor: pointer; padding: 8px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); transition: border-color var(--transition); }
.enroll-form .check-label:hover { border-color: var(--text-muted); }
.enroll-form .check-label input { width: auto; margin: 0; }
.enroll-btn { display: block; width: 100%; padding: 14px; background: var(--text); color: var(--white); border: none; border-radius: var(--radius-pill); font-size: 16px; font-weight: 700; cursor: pointer; font-family: var(--font); transition: background var(--transition); margin-top: 8px; }
.enroll-btn:hover { background: var(--tomato-hover); }
.enroll-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.error { background: #fef2f2; color: #b91c1c; padding: 10px 14px; border-radius: var(--radius); font-size: 13px; margin-bottom: 14px; display: none; }
.success { text-align: center; padding: 24px 0; }
.success h3 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
.success p { color: var(--text-secondary); font-size: 14px; }
.terms-check { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-secondary); cursor: pointer; padding: 14px 0 10px; }
.terms-box { background: var(--snow); border-radius: var(--radius); padding: 14px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; max-height: 160px; overflow-y: auto; margin: 8px 0 12px; display: none; }
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
  .mobile-nav { position: fixed; top: 0; left: 0; right: 0; background: var(--white); z-index: 100; padding: 20px 24px; display: none; flex-direction: column; gap: 16px; border-bottom: 1px solid var(--border); }
  .mobile-nav.open { display: flex; }
  .mobile-nav a { font-size: 16px; font-weight: 500; color: var(--text); }
  .hero h1 { font-size: 32px; }
  .learn-grid, .highlights-grid, .who-grid { grid-template-columns: 1fr !important; }
}
`;
